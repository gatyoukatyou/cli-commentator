import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDeepSeekAdapter,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
} from "../llm/providers/deepseek.js";

describe("createDeepSeekAdapter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("requires DEEPSEEK_API_KEY", () => {
    expect(() => createDeepSeekAdapter({})).toThrow(
      "DEEPSEEK_API_KEY is required for DeepSeek provider"
    );
  });

  it("uses the official V4 Flash defaults", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "OK" } }] }),
    });

    const adapter = createDeepSeekAdapter({ DEEPSEEK_API_KEY: "test-key" });
    await adapter.generateText({ messages: [{ role: "user", content: "Hi" }] });

    expect(adapter.name).toBe("deepseek");
    expect(fetch).toHaveBeenCalledWith(
      `${DEFAULT_DEEPSEEK_BASE_URL}/chat/completions`,
      expect.anything()
    );
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.model).toBe(DEFAULT_DEEPSEEK_MODEL);
  });

  it("accepts custom endpoint and model settings", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "OK" } }] }),
    });

    const adapter = createDeepSeekAdapter({
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_BASE_URL: "https://example.test/v1",
      DEEPSEEK_MODEL: "deepseek-custom",
    });
    await adapter.generateText({ messages: [{ role: "user", content: "Hi" }] });

    expect(fetch).toHaveBeenCalledWith(
      "https://example.test/v1/chat/completions",
      expect.anything()
    );
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.model).toBe("deepseek-custom");
  });
});

describe("DeepSeek factory integration", () => {
  it("creates the DeepSeek adapter", async () => {
    const { createLLMAdapter } = await import("../llm/factory.js");
    const adapter = createLLMAdapter({
      LLM_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "test-key",
    });

    expect(adapter.name).toBe("deepseek");
  });
});
