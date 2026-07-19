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
