import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createOpenAIAdapter } from "../llm/providers/openai.js";

describe("createOpenAIAdapter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws when OPENAI_API_KEY is missing", () => {
    expect(() => createOpenAIAdapter({})).toThrow("OPENAI_API_KEY is required");
    expect(() => createOpenAIAdapter({ OPENAI_API_KEY: "" })).toThrow(
      "OPENAI_API_KEY is required"
    );
  });

  it("creates adapter with required API key", () => {
    const adapter = createOpenAIAdapter({ OPENAI_API_KEY: "sk-test" });
    expect(adapter.name).toBe("openai");
  });

  it("uses default base URL when not specified", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "OK" } }],
        }),
    });

    const adapter = createOpenAIAdapter({ OPENAI_API_KEY: "sk-test" });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.anything()
    );
  });

  it("uses custom base URL when specified", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "OK" } }],
        }),
    });

    const adapter = createOpenAIAdapter({
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "https://custom.openai.azure.com/v1",
    });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://custom.openai.azure.com/v1/chat/completions",
      expect.anything()
    );
  });

  it("uses default model gpt-4o-mini when not specified", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "OK" } }],
        }),
    });

    const adapter = createOpenAIAdapter({ OPENAI_API_KEY: "sk-test" });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);

    expect(body.model).toBe("gpt-4o-mini");
  });

  it("uses custom model when specified", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "OK" } }],
        }),
    });

    const adapter = createOpenAIAdapter({
      OPENAI_API_KEY: "sk-test",
      OPENAI_MODEL: "gpt-4-turbo",
    });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);

    expect(body.model).toBe("gpt-4-turbo");
  });

  it("sends correct Authorization header", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "OK" } }],
        }),
    });

    const adapter = createOpenAIAdapter({ OPENAI_API_KEY: "sk-test-key-123" });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test-key-123",
        }),
      })
    );
  });

  it("throws comment_llm_error on 401 Unauthorized", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({
          error: { message: "Invalid API key" },
        }),
    });

    const adapter = createOpenAIAdapter({ OPENAI_API_KEY: "invalid-key" });

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

  it("createLLMAdapter returns openai adapter when LLM_PROVIDER=openai", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";

    const { createLLMAdapter } = await import("../llm/factory.js");
    const adapter = createLLMAdapter();

    expect(adapter.name).toBe("openai");
  });

  it("createLLMAdapter throws when openai provider lacks API key", async () => {
    process.env.LLM_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;

    const { createLLMAdapter } = await import("../llm/factory.js");

    expect(() => createLLMAdapter()).toThrow("OPENAI_API_KEY is required");
  });
});
