import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLocalAdapter } from "../llm/providers/local.js";

describe("createLocalAdapter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("creates adapter without any env vars (uses defaults)", () => {
    const adapter = createLocalAdapter({});
    expect(adapter.name).toBe("local");
  });

  it("uses default Ollama base URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "OK" } }],
        }),
    });

    const adapter = createLocalAdapter({});
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:11434/v1/chat/completions",
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

    const adapter = createLocalAdapter({
      LOCAL_BASE_URL: "http://localhost:8080/v1",
    });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/v1/chat/completions",
      expect.anything()
    );
  });

  it("uses default model llama3.2", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "OK" } }],
        }),
    });

    const adapter = createLocalAdapter({});
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);

    expect(body.model).toBe("llama3.2");
  });

  it("uses custom model when specified", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "OK" } }],
        }),
    });

    const adapter = createLocalAdapter({
      LOCAL_MODEL: "mistral",
    });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);

    expect(body.model).toBe("mistral");
  });

  it("uses custom API key when specified", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "OK" } }],
        }),
    });

    const adapter = createLocalAdapter({
      LOCAL_API_KEY: "custom-key",
    });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer custom-key",
        }),
      })
    );
  });

  it("uses not-required as default API key", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "OK" } }],
        }),
    });

    const adapter = createLocalAdapter({});
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer not-required",
        }),
      })
    );
  });

  it("throws comment_llm_error when endpoint is unreachable", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const adapter = createLocalAdapter({});

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

  it("works with vLLM endpoint", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "vLLM response" } }],
        }),
    });

    const adapter = createLocalAdapter({
      LOCAL_BASE_URL: "http://localhost:8000/v1",
      LOCAL_MODEL: "Qwen/Qwen2.5-7B-Instruct",
    });

    const result = await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.text).toBe("vLLM response");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/v1/chat/completions",
      expect.anything()
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

  it("createLLMAdapter returns local adapter when LLM_PROVIDER=local", async () => {
    process.env.LLM_PROVIDER = "local";

    const { createLLMAdapter } = await import("../llm/factory.js");
    const adapter = createLLMAdapter();

    expect(adapter.name).toBe("local");
  });

  it("createLLMAdapter works without any local env vars", async () => {
    process.env.LLM_PROVIDER = "local";
    delete process.env.LOCAL_BASE_URL;
    delete process.env.LOCAL_MODEL;
    delete process.env.LOCAL_API_KEY;

    const { createLLMAdapter } = await import("../llm/factory.js");
    const adapter = createLLMAdapter();

    expect(adapter.name).toBe("local");
  });
});
