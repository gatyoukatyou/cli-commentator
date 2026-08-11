import { describe, expect, it } from "vitest";
import { createSessionContext } from "../session-context.js";
import type { CommentaryPayload, Event } from "../types.js";
import { applySpeechContract } from "./speech-policy.js";

function observed(event: Event) {
  const context = createSessionContext();
  return context.observeEvent(event);
}

describe("commentary speech policy", () => {
  it("uses the complete display narration for speech", () => {
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
      text: payload.narration,
    });
  });

  it("keeps long progress narration identical on screen and in speech", () => {
    const event: Event = {
      ts: 1,
      type: "read",
      summary: "設定ファイルを確認",
      detail: "apps/server/src/commentary/speech-policy.ts",
    };
    const narration = "読み上げポリシーの設定ファイルを確認し、進捗の文字数制限を調べています。";
    const explanation = "詳しい確認内容は画面に残します。";
    const result = applySpeechContract({ narration, explanation }, event, observed(event));

    expect(result.narration).toBe(narration);
    expect(result.explanation).toBe(explanation);
    expect(result.speech?.text).toBe(narration);
    expect(result.speech?.text?.length).toBeGreaterThan(30);
  });

  it("uses the visible explanation when narration is absent", () => {
    const event: Event = { ts: 1, type: "read", summary: "読取" };
    const explanation = "表示される補足説明を読み上げます。";
    const result = applySpeechContract({ narration: " ", explanation }, event, observed(event));

    expect(result.speech?.text).toBe(explanation);
  });

  it("routes urgent speech through the dedicated urgent policy", () => {
    const event: Event = {
      ts: 1,
      type: "error",
      summary: "承認が必要",
      detail: "HUMANの承認を待っています",
    };
    const narration = "公開操作を続けるにはHUMANによる内容確認と明示的な承認が必要です。";
    const result = applySpeechContract({ narration }, event, observed(event));

    expect(result.speech?.text).toBe("要対応です：承認が必要。");
    expect(result.speech?.text).not.toBe("調査段階に移りました。");
  });

  it.each([
    "差分の確認が終わったで。",
    "差分の確認が終わったのだ。",
  ])("keeps a complete short character-style sentence unchanged: %s", (narration) => {
    const event: Event = {
      ts: 1,
      type: "read",
      summary: "差分確認",
      detail: "apps/server/src/commentary/orchestrator.ts",
    };
    const result = applySpeechContract({ narration }, event, observed(event));

    expect(result.speech?.text).toBe(narration);
    expect(result.speech?.text?.length).toBeLessThanOrEqual(30);
  });

  it("keeps a long quoted progress narration identical on screen and in speech", () => {
    const event: Event = {
      ts: 1,
      type: "read",
      summary: "対象を確認",
      detail: "apps/server/src/commentary/orchestrator.ts",
    };
    const narration = "今の対象は「apps/server/src/commentary/orchestrator.ts」です。";
    const result = applySpeechContract({ narration }, event, observed(event));

    expect(result.speech?.text).toBe(narration);
    expect(result.speech?.text?.length).toBeGreaterThan(30);
    expect(result.speech?.text).not.toContain("…chestrator");
  });

  it("keeps context-rich overlong progress narration identical on screen and in speech", () => {
    const event: Event = {
      ts: 1,
      type: "test",
      summary: "検証",
      detail: "package.json",
    };
    const narration = "検証段階に入り、「apps/server/package.json」を扱っています。";
    const result = applySpeechContract({ narration }, event, observed(event));

    expect(result.speech?.text).toBe(narration);
    expect(result.speech?.text?.length).toBeGreaterThan(30);
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

  it("summarizes an urgent approval command without speaking the full command", () => {
    const event: Event = {
      ts: 1,
      type: "stdout",
      summary: "コマンド実行の確認待ち",
      detail: "Would you like to run the following command?\npnpm test -- --runInBand",
    };
    const result = applySpeechContract(
      { narration: "HUMANの入力を待っています。" },
      event,
      observed(event)
    );

    expect(result.speech?.text).toBe("要対応です：「テスト」の実行許可を求めています。");
    expect(result.speech?.text).not.toContain("pnpm");
    expect(result.speech?.text).not.toContain("--runInBand");
  });

  it("uses a spoken fallback when an urgent approval target cannot be extracted", () => {
    const event: Event = {
      ts: 1,
      type: "stdout",
      summary: "コマンド実行の確認待ち",
      detail: "Would you like to run the following command?",
    };
    const result = applySpeechContract({}, event, observed(event));

    expect(result.speech?.text).toBe("要対応です：コマンドの実行許可を求めています。");
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

  // A file name is the whole point of a detail-aware narration. The raw-command
  // guard used to match `tsx` inside `App.tsx` and replace the sentence with a
  // generic fallback, silently undoing the improvement on the spoken path.
  it("speaks a narration that names a file", () => {
    const event: Event = { ts: 1, type: "read", summary: "読取", detail: "⏺ Read(apps/web/src/App.tsx)" };
    const result = applySpeechContract({ narration: "App.tsx を確認しています。" }, event, observed(event));
    expect(result.speech?.text).toBe("App.tsx を確認しています。");
  });

  it.each([
    "git status を確認しています。",
    "pnpm test を実行しています。",
    "rg -n foo apps を実行しています。",
  ])("still refuses raw command text: %s", (narration) => {
    const event: Event = { ts: 1, type: "read", summary: "読取", detail: "⏺ Read(src/a.ts)" };
    const result = applySpeechContract({ narration }, event, observed(event));
    expect(result.speech?.text).not.toBe(narration);
  });

  // When the provider's sentence is rejected the fallback must still name the
  // target, otherwise every rejected event collapses to the same generic line.
  // A phase change outranks the subject, so settle the phase first.
  describe("fallback after the phase has settled", () => {
    function afterPhase(event: Event) {
      let now = 0;
      const context = createSessionContext({ now: () => now });
      context.observeEvent({ ts: 1, type: "read", summary: "読取", detail: "⏺ Read(src/first.ts)" });
      now = 10_000;
      return context.observeEvent(event);
    }

    it("names the target", () => {
      const event: Event = { ts: 2, type: "read", summary: "読取", detail: "⏺ Read(apps/web/src/App.tsx)" };
      const result = applySpeechContract({ narration: "cat App.tsx" }, event, afterPhase(event));
      expect(result.speech?.text).toBe("App.tsx を確認しています。");
    });

    it("keeps the generic sentence when the target is not a real file name", () => {
      const detail = "⏺ Read(nl -ba src/a.ts | sed -n '1,10p')";
      const event: Event = { ts: 2, type: "read", summary: "読取", detail };
      const result = applySpeechContract({ narration: "cat something" }, event, afterPhase(event));
      expect(result.speech?.text).toBe("対象ファイルを確認しています。");
    });
  });

  it("preserves legacy behavior when context is unavailable", () => {
    const payload = { narration: "従来の実況です。" };
    expect(applySpeechContract(payload, { ts: 1, type: "stdout", summary: "ログ" }))
      .toEqual(payload);
  });
});
