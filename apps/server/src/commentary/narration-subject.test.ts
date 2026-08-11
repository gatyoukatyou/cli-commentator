import { describe, expect, it } from "vitest";
import { describeNarrationSubject } from "./narration-subject.js";
import { commentByRules } from "./rule-based.js";
import { applySpeechContract } from "./speech-policy.js";
import { createSessionContext } from "../session-context.js";
import { commentStandard } from "../styles/standard.js";
import { commentKansai } from "../styles/kansai.js";
import { commentZundamon } from "../styles/zundamon.js";
import type { Event, EventType } from "../types.js";

function event(type: EventType, detail?: string): Event {
  return { ts: 0, type, summary: "テスト用", detail };
}

describe("describeNarrationSubject", () => {
  it("names the file a read touches", () => {
    const subject = describeNarrationSubject(event("read", "⏺ Read(apps/web/src/App.tsx)"));
    expect(subject).toEqual({ kind: "file", name: "App.tsx" });
  });

  it("names the file a write touches", () => {
    const subject = describeNarrationSubject(event("write", "⏺ Update(apps/server/src/index.ts)"));
    expect(subject).toEqual({ kind: "file", name: "index.ts" });
  });

  it("names the search term", () => {
    const subject = describeNarrationSubject(event("search", "⏺ Bash(rg -n queueSpeech apps)"));
    expect(subject).toEqual({ kind: "searchTerm", term: "queueSpeech" });
  });

  it("clips a search term that would blow the speech budget", () => {
    const subject = describeNarrationSubject(event("search", "⏺ Bash(rg -n shortenProgressSpeech apps)"));
    expect(subject).toEqual({ kind: "searchTerm", term: "shortenProgressSpee…" });
  });

  it("distinguishes a type check from an automated test", () => {
    expect(describeNarrationSubject(event("test", "⏺ Bash(pnpm exec tsc --noEmit)"))).toEqual({
      kind: "check",
      label: "型チェック",
    });
    expect(describeNarrationSubject(event("test", "⏺ Bash(pnpm exec vitest run)"))).toEqual({
      kind: "check",
      label: "自動テスト",
    });
  });

  it("reports test counts when the run has reported them", () => {
    expect(describeNarrationSubject(event("test", "Tests  2 failed | 10 passed (12)"))).toEqual({
      kind: "testResult",
      failed: 2,
      passed: 10,
    });
  });

  // `Read(...)` is synthesized from tool-call lines, so its payload is not
  // guaranteed to be a path. Speaking the basename of a pipeline would read out
  // "rule-based.ts | sed -n '1,120p'".
  it("refuses a Read payload that is really a shell command", () => {
    const detail = "⏺ Read(nl -ba apps/server/src/commentary/rule-based.ts | sed -n '1,120p')";
    expect(describeNarrationSubject(event("read", detail))).toEqual({ kind: "none" });
  });

  it("refuses a search pattern that is a regex or JSON fragment", () => {
    for (const pattern of ["buildSpeechText|queueSpeech", '"name": "cli-commentator"']) {
      const subject = describeNarrationSubject(event("search", `⏺ Bash(rg -n '${pattern}' apps)`));
      expect(subject.kind).not.toBe("searchTerm");
    }
  });

  it("returns none when there is no detail to work from", () => {
    expect(describeNarrationSubject(event("read"))).toEqual({ kind: "none" });
  });

  // Before this, every git operation produced "Gitで変更履歴を整理しています。"
  // and every GitHub one produced "GitHub上のIssue/PRを操作しています。"
  it.each([
    ["git", "git status", "変更の一覧を確認"],
    ["git", "git commit -m 'x'", "変更を記録"],
    ["git", "git push origin main", "GitHubへ送信"],
    ["git", "git diff --stat", "変更前後を比較"],
    ["git", "git log --oneline", "変更履歴を確認"],
    ["git", "git switch -c feat/x", "作業ブランチを変更"],
    ["git", "git rebase origin/main", "変更をひとつに統合"],
    ["github", "gh pr checks --watch", "PRの自動チェックを確認"],
    ["github", "gh pr create --fill", "レビュー依頼を作成"],
    ["github", "gh pr merge 373 --squash", "PRを取り込み"],
    ["github", "gh pr view 373", "PRの状態を確認"],
    ["github", "gh issue list", "課題を確認"],
    ["github", "gh run watch", "CIの状況を確認"],
  ])("names the %s operation: %s", (type, command, phrase) => {
    const subject = describeNarrationSubject(event(type as EventType, `⏺ Bash(${command})`));
    expect(subject).toEqual({ kind: "action", phrase });
  });

  it.each([
    ["pnpm add zod", "zod を追加"],
    // A flag must not be mistaken for the package name.
    ["pnpm add -D vitest", "vitest を追加"],
    ["pnpm remove zod", "zod を削除"],
    ["pnpm install", "依存を準備"],
  ])("names the dependency change: %s", (command, phrase) => {
    const subject = describeNarrationSubject(event("install", `⏺ Bash(${command})`));
    expect(subject).toEqual({ kind: "action", phrase });
  });

  it("separates starting a server from a server that has started", () => {
    expect(describeNarrationSubject(event("server", "⏺ Bash(pnpm dev)"))).toEqual({
      kind: "action",
      phrase: "サーバーを起動",
    });
    expect(describeNarrationSubject(event("server", "Local: http://localhost:5173"))).toEqual({
      kind: "action",
      phrase: "サーバーの起動を確認",
    });
  });

  // `error` is urgent priority, so its speech comes from buildUrgentSpeechText
  // rather than narration; `build`/`lint` carry nothing past their event type.
  it.each(["error", "build", "lint"] as const)("leaves %s to its type-level sentence", (type) => {
    expect(describeNarrationSubject(event(type, "⏺ Bash(pnpm build)"))).toEqual({ kind: "none" });
  });
});

describe("narration with a subject", () => {
  const cases: Array<[EventType, string]> = [
    ["read", "⏺ Read(apps/web/src/App.tsx)"],
    ["write", "⏺ Update(apps/server/src/commentary/speech-policy.ts)"],
    ["search", "⏺ Bash(rg -n shortenProgressSpeech apps)"],
    ["test", "⏺ Bash(pnpm exec tsc --noEmit)"],
    ["test", "Tests  2 failed | 10 passed (12)"],
    ["git", "⏺ Bash(git commit -m 'x')"],
    ["github", "⏺ Bash(gh pr checks --watch)"],
    ["install", "⏺ Bash(pnpm add -D vitest)"],
    ["server", "⏺ Bash(pnpm dev)"],
  ];

  it.each(cases)("names the subject in every style (%s)", (type, detail) => {
    const ev = event(type, detail);
    const subject = describeNarrationSubject(ev);
    for (const comment of [commentStandard, commentKansai, commentZundamon]) {
      expect(comment(ev, subject)).not.toBe(comment(ev));
    }
  });

  it.each(cases)("uses the visible subject narration for speech (%s)", (type, detail) => {
    const ev = event(type, detail);
    const context = createSessionContext();
    const snapshot = context.observeEvent(ev);
    for (const style of ["standard", "kansai", "zundamon"] as const) {
      const payload = commentByRules(ev, style, snapshot);
      expect(payload.narration).toBeTruthy();
      expect(applySpeechContract(payload, ev, snapshot).speech?.text).toBe(payload.narration);
    }
  });

  it("keeps a clipped long file target identical on screen and in speech", () => {
    const ev = event("write", "⏺ Update(apps/server/src/commentary/an-extremely-long-module-name.ts)");
    const context = createSessionContext();
    const snapshot = context.observeEvent(ev);
    const payload = commentByRules(ev, "standard", snapshot);
    expect(payload.narration).toContain("an-extremely-long");
    expect(applySpeechContract(payload, ev, snapshot).speech?.text).toBe(payload.narration);
  });

  // Regression: the phase-change line carries the full path. It must remain
  // the same on screen and in normal speech instead of taking a fallback path.
  it("keeps the subject on a phase change in both channels", () => {
    const event: Event = {
      ts: 1,
      type: "write",
      summary: "更新",
      detail: "⏺ Update(apps/server/src/commentary/speech-policy.ts)",
    };
    const context = createSessionContext();
    const snapshot = context.observeEvent(event);
    expect(snapshot.phaseChanged).toBe(true);

    const payload = commentByRules(event, "standard", snapshot);
    expect(payload.narration).toContain("speech-policy.ts");

    const spoken = applySpeechContract(payload, event, snapshot).speech?.text;
    expect(spoken).toBe(payload.narration);
  });

  it("falls back to the type-level sentence when nothing is identified", () => {
    const ev = event("read");
    expect(commentStandard(ev, describeNarrationSubject(ev))).toBe(
      "ファイルを読んで状況を確認しています。"
    );
  });

  it("describes silent waiting without claiming an unknown target is being handled", () => {
    const waitingEvent: Event = {
      ts: 1,
      type: "stdout",
      summary: "長考・沈黙が続いている",
      detail: "60000ms outputなし",
    };
    const context = createSessionContext();
    context.setTaskContext({ objective: "動作を確認する", source: "fixture" });
    context.observeEvent(event("search", "rg context src"));
    const snapshot = context.observeEvent(waitingEvent);

    const payload = commentByRules(waitingEvent, "kansai", snapshot);
    expect(payload.narration).toContain("次の出力を待ってる");
    expect(payload.narration).not.toContain("対象を扱ってる");
    expect(payload.explanation).toBe(
      "エラーではありません。処理を続けながら、次の出力を待っている状態です。"
    );
  });
});
