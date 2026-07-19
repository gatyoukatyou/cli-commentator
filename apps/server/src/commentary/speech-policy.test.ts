import { describe, expect, it } from "vitest";
import { createSessionContext } from "../session-context.js";
import type { CommentaryPayload, Event } from "../types.js";
import { applySpeechContract } from "./speech-policy.js";

function observed(event: Event) {
  const context = createSessionContext();
  return context.observeEvent(event);
}

describe("commentary speech policy", () => {
  it("keeps display text but exposes only one sentence for speech", () => {
    const event: Event = { ts: 1, type: "read", summary: "読取", detail: "⏺ Read(src/a.ts)" };
    const payload: CommentaryPayload = {
      narration: "対象ファイルを確認しています。 詳しい根拠は画面に表示します。",
      explanation: "初心者向けの詳しい説明です。",
      glossaryNotes: ["補足: 用語説明"],
    };
    const result = applySpeechContract(payload, event, observed(event));

    expect(result.narration).toBe(payload.narration);
    expect(result.explanation).toBe(payload.explanation);
    expect(result.glossaryNotes).toEqual(payload.glossaryNotes);
    expect(result.speech).toEqual({
      disposition: "speak",
      reason: "new_task",
      text: "対象ファイルを確認しています。",
    });
  });

  it("falls back to a safe sentence instead of speaking a raw command", () => {
    const event: Event = {
      ts: 1,
      type: "search",
      summary: "検索",
      detail: '⏺ Grep(rg -n "buildSpeechText|queueSpeech|rawDetail" apps/web/src)',
    };
    const result = applySpeechContract(
      { narration: 'rg -n "buildSpeechText|queueSpeech|rawDetail" apps/web/src を実行しています。' },
      event,
      observed(event)
    );

    expect(result.speech?.text).toBe("調査段階に移りました。");
    expect(result.speech?.text).not.toContain("rg -n");
    expect(result.speech?.text).not.toContain("|");
  });

  it.each([
    "git status を確認しています。",
    "pnpm test を実行しています。",
    "gh pr view を確認しています。",
  ])("does not speak a common raw command: %s", (narration) => {
    const event: Event = { ts: 1, type: "read", summary: "確認", detail: "src/a.ts" };
    const result = applySpeechContract({ narration }, event, observed(event));
    expect(result.speech?.text).toBe("調査段階に移りました。");
    expect(result.speech?.text).not.toBe(narration);
  });

  it("uses a failure sentence for a non-zero PTY exit", () => {
    const event: Event = { ts: 1, type: "done", summary: "終了 code=1" };
    const result = applySpeechContract(
      { narration: "作業が完了しました。" },
      event,
      observed(event)
    );
    expect(result.speech).toEqual({
      disposition: "speak",
      reason: "failure",
      text: "処理が正常に終了しませんでした。",
    });
  });

  it.each([
    ["終了 code=0", "作業が完了しました。"],
    ["終了", "処理が終了しました。"],
  ])("uses an exit-code-safe sentence for %s", (summary, expectedText) => {
    const event: Event = { ts: 1, type: "done", summary };
    const result = applySpeechContract(
      { narration: "作業が完了しました。" },
      event,
      observed(event)
    );
    expect(result.speech?.text).toBe(expectedText);
  });

  it("omits speech text for display-only decisions", () => {
    let now = 0;
    const context = createSessionContext({ now: () => now });
    const event: Event = { ts: 1, type: "read", summary: "読取", detail: "⏺ Read(src/a.ts)" };
    context.observeEvent(event);
    now = 1;
    const result = applySpeechContract({ narration: "同じ確認です。" }, event, context.observeEvent(event));
    expect(result.speech).toEqual({ disposition: "display_only", reason: "progress_interval" });
  });

  it("preserves legacy behavior when context is unavailable", () => {
    const payload = { narration: "従来の実況です。" };
    expect(applySpeechContract(payload, { ts: 1, type: "stdout", summary: "ログ" }))
      .toEqual(payload);
  });
});
