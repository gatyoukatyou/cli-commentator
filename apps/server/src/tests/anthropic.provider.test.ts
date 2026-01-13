import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAnthropicAdapter } from "../llm/providers/anthropic.js";

describe("createAnthropicAdapter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws when ANTHROPIC_API_KEY is missing", () => {
    expect(() => createAnthropicAdapter({})).toThrow("ANTHROPIC_API_KEY is required");
    expect(() => createAnthropicAdapter({ ANTHROPIC_API_KEY: "" })).toThrow(
      "ANTHROPIC_API_KEY is required"
    );
  });

  it("creates adapter with required API key", () => {
    const adapter = createAnthropicAdapter({ ANTHROPIC_API_KEY: "test-key" });
    expect(adapter.name).toBe("anthropic");
  });

  it("uses default base URL when not specified", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "OK" }],
        }),
    });

    const adapter = createAnthropicAdapter({ ANTHROPIC_API_KEY: "test-key" });
    await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.anything()
    );
  });

  it("sends required headers and separates system prompt", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "OK" }],
        }),
    });

    const adapter = createAnthropicAdapter({ ANTHROPIC_API_KEY: "test-key" });
    await adapter.generateText({
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ],
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "x-api-key": "test-key",
          "anthropic-version": "2023-06-01",
        }),
      })
    );

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);

    expect(body.system).toBe("Be concise.");
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Hi" }] },
      { role: "assistant", content: [{ type: "text", text: "Hello" }] },
    ]);
  });

  it("extracts text blocks and usage from response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [
            { type: "text", text: "Hello" },
            { type: "tool_use", text: "ignored" },
            { type: "text", text: " world" },
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 4,
          },
        }),
    });

    const adapter = createAnthropicAdapter({ ANTHROPIC_API_KEY: "test-key" });
    const result = await adapter.generateText({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.text).toBe("Hello world");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 4 });
  });

  it("passes signal to fetch", async () => {
    const controller = new AbortController();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "OK" }],
        }),
    });

    const adapter = createAnthropicAdapter({ ANTHROPIC_API_KEY: "test-key" });
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

  it("throws comment_aborted when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const adapter = createAnthropicAdapter({ ANTHROPIC_API_KEY: "test-key" });

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

    const adapter = createAnthropicAdapter({ ANTHROPIC_API_KEY: "test-key" });

    await expect(
      adapter.generateText({
        messages: [{ role: "user", content: "Hi" }],
      })
    ).rejects.toMatchObject({
      name: "CommentError",
      code: "comment_aborted",
    });
  });

  it("throws comment_llm_error on HTTP error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({
          error: { message: "Invalid API key" },
        }),
    });

    const adapter = createAnthropicAdapter({ ANTHROPIC_API_KEY: "bad-key" });

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
