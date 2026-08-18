import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOpenCodeGoAdapter,
  DEFAULT_OPENCODE_GO_BASE_URL,
  DEFAULT_OPENCODE_GO_MODEL,
} from "../llm/providers/opencode-go.js";

describe("createOpenCodeGoAdapter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("requires OPENCODE_GO_API_KEY", () => {
    expect(() => createOpenCodeGoAdapter({})).toThrow(
      "OPENCODE_GO_API_KEY is required for OpenCode Go provider"
    );
  });

  it("uses the OpenCode Go chat/completions defaults", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "OK" } }] }),
    });

    const adapter = createOpenCodeGoAdapter({ OPENCODE_GO_API_KEY: "test-key" });
    await adapter.generateText({ messages: [{ role: "user", content: "Hi" }] });

    expect(adapter.name).toBe("opencode-go");
    expect(fetch).toHaveBeenCalledWith(
      `${DEFAULT_OPENCODE_GO_BASE_URL}/chat/completions`,
      expect.anything()
    );
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.model).toBe(DEFAULT_OPENCODE_GO_MODEL);
  });

  it("accepts a custom model", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "OK" } }] }),
    });

    const adapter = createOpenCodeGoAdapter({
      OPENCODE_GO_API_KEY: "test-key",
      OPENCODE_GO_MODEL: "kimi-k3",
    });
    await adapter.generateText({ messages: [{ role: "user", content: "Hi" }] });

    expect(fetch).toHaveBeenCalledWith(
      `${DEFAULT_OPENCODE_GO_BASE_URL}/chat/completions`,
      expect.anything()
    );
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.model).toBe("kimi-k3");
  });
});

describe("OpenCode Go factory integration", () => {
  it("creates the OpenCode Go adapter", async () => {
    const { createLLMAdapter } = await import("../llm/factory.js");
    const adapter = createLLMAdapter({
      LLM_PROVIDER: "opencode-go",
      OPENCODE_GO_API_KEY: "test-key",
    });

    expect(adapter.name).toBe("opencode-go");
  });
});
