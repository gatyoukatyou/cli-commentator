import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Event } from "../types.js";

describe("comment() timeout behavior", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it("aborts and falls back to rules when LLM takes too long", async () => {
    // 短いタイムアウトを設定
    process.env.LLM_PROVIDER = "mock";
    process.env.COMMENT_TIMEOUT_MS = "100";

    // mock adapter を遅延させる
    vi.doMock("../llm/factory.js", () => ({
      createLLMAdapter: () => ({
        name: "hanging",
        async generateText() {
          // 1秒待つ（タイムアウトより長い）
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return { text: "should not reach here" };
        },
      }),
    }));

    const { comment } = await import("../styles/index.js");

    const ev: Event = {
      ts: Date.now(),
      type: "cmd",
      summary: "テストコマンド",
    };

    // comment() は abort されてルールベースにフォールバック
    const result = await comment(ev, "standard");

    // ルール実況の特徴を含む（LLMレスポンスではない）
    expect(result).toContain("初心者向け");
    expect(result).not.toBe("should not reach here");

    // Clean up the mock for next test
    vi.doUnmock("../llm/factory.js");
  });

  it("returns normally when LLM responds within timeout", async () => {
    vi.resetModules();
    process.env.LLM_PROVIDER = "mock";
    process.env.COMMENT_TIMEOUT_MS = "5000";

    // factory.js の mock を解除して本来の mock adapter を使う
    const { comment } = await import("../styles/index.js");

    const ev: Event = {
      ts: Date.now(),
      type: "cmd",
      summary: "テストコマンド",
    };

    const result = await comment(ev, "standard");

    // mock アダプタのレスポンス
    expect(result).toContain("[mock-");
  });

  it("signal is aborted after timeout", async () => {
    process.env.LLM_PROVIDER = "mock";
    process.env.COMMENT_TIMEOUT_MS = "50";

    let capturedSignal: AbortSignal | undefined;

    vi.doMock("../llm/factory.js", () => ({
      createLLMAdapter: () => ({
        name: "signal-checker",
        async generateText(req: { signal?: AbortSignal }) {
          capturedSignal = req.signal;
          // signal が abort されるまで待つ
          await new Promise((resolve) => setTimeout(resolve, 200));
          return { text: "timeout should have fired" };
        },
      }),
    }));

    const { comment } = await import("../styles/index.js");

    const ev: Event = {
      ts: Date.now(),
      type: "cmd",
      summary: "テスト",
    };

    await comment(ev, "standard");

    // signal が渡されて abort されていることを確認
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(true);

    vi.doUnmock("../llm/factory.js");
  });
});

describe("mock adapter signal handling", () => {
  it("throws when signal is already aborted", async () => {
    const { mockAdapter } = await import("../llm/providers/mock.js");

    const controller = new AbortController();
    controller.abort();

    await expect(
      mockAdapter.generateText({
        messages: [{ role: "user", content: "test" }],
        signal: controller.signal,
      })
    ).rejects.toThrow("Aborted");
  });
});
