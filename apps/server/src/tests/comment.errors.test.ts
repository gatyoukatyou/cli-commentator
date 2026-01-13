import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CommentError } from "../errors.js";
import type { Event } from "../types.js";

describe("CommentError", () => {
  it("has correct code for timeout", () => {
    const err = new CommentError("comment_timeout");
    expect(err.code).toBe("comment_timeout");
    expect(err.name).toBe("CommentError");
    expect(err.message).toBe("comment_timeout");
  });

  it("has correct code for aborted", () => {
    const err = new CommentError("comment_aborted");
    expect(err.code).toBe("comment_aborted");
  });

  it("has correct code for llm_error", () => {
    const err = new CommentError("comment_llm_error", "Rate limit exceeded");
    expect(err.code).toBe("comment_llm_error");
    expect(err.message).toBe("Rate limit exceeded");
  });

  it("is instanceof Error", () => {
    const err = new CommentError("comment_timeout");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CommentError);
  });
});

describe("mock adapter error codes", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws comment_aborted when signal is aborted", async () => {
    const { mockAdapter } = await import("../llm/providers/mock.js");

    const controller = new AbortController();
    controller.abort();

    try {
      await mockAdapter.generateText({
        messages: [{ role: "user", content: "test" }],
        signal: controller.signal,
      });
      expect.fail("Should have thrown");
    } catch (err) {
      // Check error properties (避免 instanceof issues with module caching)
      expect((err as Error).name).toBe("CommentError");
      expect((err as { code: string }).code).toBe("comment_aborted");
    }
  });

  it("throws comment_llm_error when MOCK_LLM_MODE=error", async () => {
    process.env.MOCK_LLM_MODE = "error";

    const { mockAdapter } = await import("../llm/providers/mock.js");

    try {
      await mockAdapter.generateText({
        messages: [{ role: "user", content: "test" }],
      });
      expect.fail("Should have thrown");
    } catch (err) {
      // Check error properties (避免 instanceof issues with module caching)
      expect((err as Error).name).toBe("CommentError");
      expect((err as { code: string }).code).toBe("comment_llm_error");
    }
  });
});

describe("comment() error classification", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = originalEnv;
  });

  it("logs timeout when LLM takes too long", async () => {
    process.env.LLM_PROVIDER = "mock";
    process.env.COMMENT_TIMEOUT_MS = "50";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.doMock("../llm/factory.js", () => ({
      createLLMAdapter: () => ({
        name: "slow",
        async generateText() {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return { text: "slow response" };
        },
      }),
    }));

    const { comment } = await import("../styles/index.js");

    const ev: Event = { ts: Date.now(), type: "cmd", summary: "test" };
    await comment(ev, "standard");

    expect(warnSpy).toHaveBeenCalled();
    const logMessage = warnSpy.mock.calls[0]?.[0] as string;
    expect(logMessage).toContain("comment_timeout");

    warnSpy.mockRestore();
    vi.doUnmock("../llm/factory.js");
  });

  it("logs llm_error when adapter throws", async () => {
    vi.resetModules();
    process.env.LLM_PROVIDER = "mock";
    process.env.MOCK_LLM_MODE = "error";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Must re-import after setting env vars
    const { comment } = await import("../styles/index.js");

    const ev: Event = { ts: Date.now(), type: "cmd", summary: "test" };
    await comment(ev, "standard");

    expect(warnSpy).toHaveBeenCalled();
    const logMessage = warnSpy.mock.calls[0]?.[0] as string;
    expect(logMessage).toContain("comment_llm_error");

    warnSpy.mockRestore();
  });

  it("logs ok on success when DEBUG is set", async () => {
    process.env.LLM_PROVIDER = "mock";
    process.env.DEBUG = "1";

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { comment } = await import("../styles/index.js");

    const ev: Event = { ts: Date.now(), type: "cmd", summary: "test" };
    await comment(ev, "standard");

    expect(logSpy).toHaveBeenCalled();
    const logMessage = logSpy.mock.calls.find((call) =>
      (call[0] as string).includes("comment_ok")
    );
    expect(logMessage).toBeDefined();

    logSpy.mockRestore();
  });
});
