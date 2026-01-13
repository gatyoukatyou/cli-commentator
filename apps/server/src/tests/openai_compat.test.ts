import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createOpenAICompatAdapter } from "../llm/providers/openai_compat.js";

describe("createOpenAICompatAdapter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const baseConfig = {
    name: "openai" as const,
    baseURL: "https://api.openai.com/v1",
    apiKey: "test-api-key",
    model: "gpt-4",
  };

  it("returns text from successful response", async () => {
    const mockResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello, world!" },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const adapter = createOpenAICompatAdapter(baseConfig);
    const result = await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.text).toBe("Hello, world!");
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(result.raw).toEqual(mockResponse);

    // Verify fetch was called with correct parameters
    expect(fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-api-key",
        },
      })
    );
  });

  it("throws comment_llm_error on API error response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: () =>
        Promise.resolve({
          error: { message: "Rate limit exceeded", type: "rate_limit_error" },
        }),
    });

    const adapter = createOpenAICompatAdapter(baseConfig);

    await expect(
      adapter.generateText({
        messages: [{ role: "user", content: "Hi" }],
      })
    ).rejects.toMatchObject({
      name: "CommentError",
      code: "comment_llm_error",
      message: "Rate limit exceeded",
    });
  });

  it("throws comment_llm_error with HTTP status when error body is not JSON", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("Not JSON")),
    });

    const adapter = createOpenAICompatAdapter(baseConfig);

    await expect(
      adapter.generateText({
        messages: [{ role: "user", content: "Hi" }],
      })
    ).rejects.toMatchObject({
      name: "CommentError",
      code: "comment_llm_error",
      message: "HTTP 500",
    });
  });

  it("throws comment_llm_error on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const adapter = createOpenAICompatAdapter(baseConfig);

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

    const adapter = createOpenAICompatAdapter(baseConfig);

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

    const adapter = createOpenAICompatAdapter(baseConfig);

    await expect(
      adapter.generateText({
        messages: [{ role: "user", content: "Hi" }],
      })
    ).rejects.toMatchObject({
      name: "CommentError",
      code: "comment_aborted",
    });
  });

  it("handles empty content in response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: null } }],
        }),
    });

    const adapter = createOpenAICompatAdapter(baseConfig);
    const result = await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.text).toBe("");
  });

  it("uses custom defaultMaxTokens and defaultTemperature", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "OK" } }],
        }),
    });

    const adapter = createOpenAICompatAdapter({
      ...baseConfig,
      defaultMaxTokens: 100,
      defaultTemperature: 0.5,
    });

    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);

    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.5);
  });

  it("strips trailing slash from baseURL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "OK" } }],
        }),
    });

    const adapter = createOpenAICompatAdapter({
      ...baseConfig,
      baseURL: "https://api.example.com/v1/",
    });

    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.anything()
    );
  });

  it("passes signal to fetch", async () => {
    const controller = new AbortController();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "OK" } }],
        }),
    });

    const adapter = createOpenAICompatAdapter(baseConfig);

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

  it("works with different baseURLs (Groq example)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "Groq response" } }],
        }),
    });

    const adapter = createOpenAICompatAdapter({
      name: "groq",
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: "groq-key",
      model: "llama-3.3-70b-versatile",
    });

    const result = await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.text).toBe("Groq response");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/chat/completions",
      expect.anything()
    );
  });
});
