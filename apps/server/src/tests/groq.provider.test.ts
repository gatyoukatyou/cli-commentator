import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGroqAdapter } from "../llm/providers/groq.js";

describe("createGroqAdapter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws when GROQ_API_KEY is missing", () => {
    expect(() => createGroqAdapter({})).toThrow("GROQ_API_KEY is required");
    expect(() => createGroqAdapter({ GROQ_API_KEY: "" })).toThrow(
      "GROQ_API_KEY is required"
    );
  });

  it("creates adapter with required API key", () => {
    const adapter = createGroqAdapter({ GROQ_API_KEY: "gsk-test" });
    expect(adapter.name).toBe("groq");
  });

  it("uses default Groq base URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "OK" } }],
        }),
    });

    const adapter = createGroqAdapter({ GROQ_API_KEY: "gsk-test" });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/chat/completions",
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

    const adapter = createGroqAdapter({
      GROQ_API_KEY: "gsk-test",
      GROQ_BASE_URL: "https://custom.groq.com/v1",
    });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://custom.groq.com/v1/chat/completions",
      expect.anything()
    );
  });

  it("uses default model llama-3.3-70b-versatile", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "OK" } }],
        }),
    });

    const adapter = createGroqAdapter({ GROQ_API_KEY: "gsk-test" });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);

    expect(body.model).toBe("llama-3.3-70b-versatile");
  });

  it("uses custom model when specified", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "OK" } }],
        }),
    });

    const adapter = createGroqAdapter({
      GROQ_API_KEY: "gsk-test",
      GROQ_MODEL: "mixtral-8x7b-32768",
    });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);

    expect(body.model).toBe("mixtral-8x7b-32768");
  });

  it("throws comment_llm_error on API error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({
          error: { message: "Invalid API key" },
        }),
    });

    const adapter = createGroqAdapter({ GROQ_API_KEY: "invalid-key" });

    await expect(
      adapter.generateText({
        messages: [{ role: "user", content: "Hi" }],
      })
    ).rejects.toMatchObject({
      name: "CommentError",
      code: "comment_llm_error",
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

  it("createLLMAdapter returns groq adapter when LLM_PROVIDER=groq", async () => {
    process.env.LLM_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "gsk-test";

    const { createLLMAdapter } = await import("../llm/factory.js");
    const adapter = createLLMAdapter();

    expect(adapter.name).toBe("groq");
  });

  it("createLLMAdapter throws when groq provider lacks API key", async () => {
    process.env.LLM_PROVIDER = "groq";
    delete process.env.GROQ_API_KEY;

    const { createLLMAdapter } = await import("../llm/factory.js");

    expect(() => createLLMAdapter()).toThrow("GROQ_API_KEY is required");
  });
});
