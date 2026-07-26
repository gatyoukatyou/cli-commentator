import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGeminiAdapter } from "../llm/providers/gemini.js";

describe("createGeminiAdapter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws when GOOGLE_API_KEY is missing", () => {
    expect(() => createGeminiAdapter({})).toThrow("GOOGLE_API_KEY is required");
    expect(() => createGeminiAdapter({ GOOGLE_API_KEY: "" })).toThrow(
      "GOOGLE_API_KEY is required"
    );
  });

  it("creates adapter with required API key", () => {
    const adapter = createGeminiAdapter({ GOOGLE_API_KEY: "test-key" });
    expect(adapter.name).toBe("gemini");
  });

  it("returns text from successful response", async () => {
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: "Hello from Gemini!" }],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
      },
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const adapter = createGeminiAdapter({ GOOGLE_API_KEY: "test-key" });
    const result = await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.text).toBe("Hello from Gemini!");
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  it("uses default model gemini-3.5-flash", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: "OK" }] } }],
        }),
    });

    const adapter = createGeminiAdapter({ GOOGLE_API_KEY: "test-key" });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("gemini-3.5-flash:generateContent"),
      expect.anything()
    );
  });

  it("uses custom model when specified", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: "OK" }] } }],
        }),
    });

    const adapter = createGeminiAdapter({
      GOOGLE_API_KEY: "test-key",
      GEMINI_MODEL: "gemini-1.5-pro",
    });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("gemini-1.5-pro:generateContent"),
      expect.anything()
    );
  });

  it("sends API key in x-goog-api-key header", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: "OK" }] } }],
        }),
    });

    const adapter = createGeminiAdapter({ GOOGLE_API_KEY: "my-api-key" });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.not.stringContaining("key=my-api-key"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-goog-api-key": "my-api-key",
        }),
      })
    );
  });

  it("disables thinking for the default short-commentary model", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: "OK" }] } }],
        }),
    });

    const adapter = createGeminiAdapter({ GOOGLE_API_KEY: "test-key" });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);

    expect(body.generationConfig.thinkingConfig).toEqual({
      thinkingBudget: 0,
    });
  });

  it("does not send thinkingConfig to legacy custom models", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: "OK" }] } }],
        }),
    });

    const adapter = createGeminiAdapter({
      GOOGLE_API_KEY: "test-key",
      GEMINI_MODEL: "gemini-1.5-pro",
    });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);

    expect(body.generationConfig.thinkingConfig).toBeUndefined();
  });

  it("converts messages to Gemini format", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: "OK" }] } }],
        }),
    });

    const adapter = createGeminiAdapter({ GOOGLE_API_KEY: "test-key" });
    await adapter.generateText({
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
        { role: "user", content: "How are you?" },
      ],
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);

    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "Hello" }] },
      { role: "model", parts: [{ text: "Hi there" }] },
      { role: "user", parts: [{ text: "How are you?" }] },
    ]);
  });

  it("throws comment_llm_error on API error response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () =>
        Promise.resolve({
          error: { message: "Invalid API key", code: 400 },
        }),
    });

    const adapter = createGeminiAdapter({ GOOGLE_API_KEY: "invalid-key" });

    await expect(
      adapter.generateText({
        messages: [{ role: "user", content: "Hi" }],
      })
    ).rejects.toMatchObject({
      name: "CommentError",
      code: "comment_llm_error",
      message: "Invalid API key",
    });
  });

  it("throws comment_llm_error on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const adapter = createGeminiAdapter({ GOOGLE_API_KEY: "test-key" });

    await expect(
      adapter.generateText({
        messages: [{ role: "user", content: "Hi" }],
      })
    ).rejects.toMatchObject({
      name: "CommentError",
      code: "comment_llm_error",
      message: "Network error: ECONNREFUSED",
    });
  });

  it("throws comment_aborted when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const adapter = createGeminiAdapter({ GOOGLE_API_KEY: "test-key" });

    await expect(
      adapter.generateText({
        messages: [{ role: "user", content: "Hi" }],
        signal: controller.signal,
      })
    ).rejects.toMatchObject({
      name: "CommentError",
      code: "comment_aborted",
    });
  });

  it("throws comment_aborted when fetch is aborted", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    const adapter = createGeminiAdapter({ GOOGLE_API_KEY: "test-key" });

    await expect(
      adapter.generateText({
        messages: [{ role: "user", content: "Hi" }],
      })
    ).rejects.toMatchObject({
      name: "CommentError",
      code: "comment_aborted",
    });
  });

  it("throws comment_llm_error for empty response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [],
        }),
    });

    const adapter = createGeminiAdapter({ GOOGLE_API_KEY: "test-key" });
    await expect(
      adapter.generateText({
        messages: [{ role: "user", content: "Hi" }],
      })
    ).rejects.toMatchObject({
      name: "CommentError",
      code: "comment_llm_error",
    });
  });

  it("passes signal to fetch", async () => {
    const controller = new AbortController();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: "OK" }] } }],
        }),
    });

    const adapter = createGeminiAdapter({ GOOGLE_API_KEY: "test-key" });

    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
      signal: controller.signal,
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: controller.signal,
      })
    );
  });
});

describe("factory integration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("createLLMAdapter returns gemini adapter when LLM_PROVIDER=gemini", async () => {
    process.env.LLM_PROVIDER = "gemini";
    process.env.GOOGLE_API_KEY = "test-key";

    const { createLLMAdapter } = await import("../llm/factory.js");
    const adapter = createLLMAdapter();

    expect(adapter.name).toBe("gemini");
  });

  it("createLLMAdapter throws when gemini provider lacks API key", async () => {
    process.env.LLM_PROVIDER = "gemini";
    delete process.env.GOOGLE_API_KEY;

    const { createLLMAdapter } = await import("../llm/factory.js");

    expect(() => createLLMAdapter()).toThrow("GOOGLE_API_KEY is required");
  });
});
