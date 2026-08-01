import { describe, expect, it } from "vitest";
import { beginnerOneLine } from "./beginner-lines.js";
import type { Event, EventType } from "../types.js";

function event(type: EventType, detail?: string): Event {
  return { ts: 1, type, summary: "テスト用", detail };
}

function bash(type: EventType, command: string): Event {
  return event(type, `⏺ Bash(${command})`);
}

describe("beginnerOneLine stdout explanations", () => {
  it("omits an explanation for a shell prompt or unknown stdout", () => {
    expect(beginnerOneLine(event("stdout", "bash-5.3$"))).toBe("");
    expect(beginnerOneLine(event("stdout", "arbitrary output"))).toBe("");
  });

  it("describes source code, file paths, and test results when identifiable", () => {
    expect(beginnerOneLine(event("stdout", "const value = 1;"))).toContain("ソースコードの一部");
    expect(beginnerOneLine(event("stdout", "apps/web/src/lib/tts.ts"))).toContain("ファイルやフォルダの一覧");
    expect(beginnerOneLine(event("stdout", "Tests 5 passed"))).toContain("テスト結果");
  });

  it("distinguishes reading a file from listing files", () => {
    expect(beginnerOneLine(event("stdout", "sed -n '1p' apps/server/src/index.ts"))).toContain(
      "ファイルの内容を読み"
    );
    expect(beginnerOneLine(event("stdout", "rg --files apps/server/src"))).toContain("一覧を見て");
  });
});

describe("beginnerOneLine coverage beyond the first matching tool call", () => {
  // Before this, only `git status` had a contextual line; every other git
  // operation collapsed to "変更履歴を整理して戻せる状態にしています。"
  it.each([
    ["git status", "変更されたファイル一覧"],
    ["git commit -m 'x'", "ひとつの区切りとして記録"],
    ["git push origin main", "GitHub側へ送っています"],
    ["git diff --stat", "意図した箇所だけが変わっているか"],
    ["git log --oneline", "変更履歴をたどって"],
    ["git switch -c feat/x", "作業する枝を切り替えて"],
    ["git rebase origin/main", "ひとつにまとめています"],
  ])("explains %s", (command, expected) => {
    expect(beginnerOneLine(bash("git", command))).toContain(expected);
  });

  it.each([
    ["gh pr checks --watch", "自動チェック結果"],
    ["gh pr create --fill", "レビュー依頼の形"],
    ["gh pr merge 373 --squash", "本流へ取り込んで"],
    ["gh pr view 373", "取り込んでよいか"],
    ["gh issue list", "課題の内容や一覧"],
    ["gh run watch", "自動処理の実行状況"],
  ])("explains %s", (command, expected) => {
    expect(beginnerOneLine(bash("github", command))).toContain(expected);
  });

  it.each([
    ["build" as EventType, "pnpm build", "実際に動かせる状態"],
    ["lint" as EventType, "pnpm exec biome check", "動作そのものではなく品質"],
    ["server" as EventType, "pnpm dev", "実際の画面や応答"],
    ["install" as EventType, "pnpm add zod", "新しい部品を追加"],
    ["install" as EventType, "pnpm remove zod", "使わなくなった部品を外して"],
  ])("explains a %s event", (type, command, expected) => {
    expect(beginnerOneLine(bash(type, command))).toContain(expected);
  });

  it("reports that a server finished starting", () => {
    expect(beginnerOneLine(event("server", "Local: http://localhost:5173"))).toContain(
      "待ち受けを始めました"
    );
  });

  // Failures used to share one line regardless of what actually went wrong.
  it.each([
    ["error" as EventType, "TS2554: Expected 1 arguments", "つながりが合っていない"],
    ["error" as EventType, "zsh: command not found: pnpm", "必要なコマンドが見つかりません"],
    ["error" as EventType, "Error: Cannot find module 'zod'", "参照している部品が見つかりません"],
    ["error" as EventType, "listen EADDRINUSE: address already in use :::8787", "既に別のプロセスに使われています"],
    ["error" as EventType, "EACCES: permission denied, open '/etc/hosts'", "権限が足りず"],
    ["error" as EventType, "ELIFECYCLE Command failed with exit code 1.", "失敗して終了しました"],
  ])("explains a %s event: %s", (type, detail, expected) => {
    expect(beginnerOneLine(event(type, detail))).toContain(expected);
  });

  it("reports how many tests failed rather than that tests ran", () => {
    expect(beginnerOneLine(event("test", "Tests  2 failed | 10 passed (12)"))).toContain(
      "2件失敗しました"
    );
    expect(beginnerOneLine(event("test", "Tests  12 passed (12)"))).toContain("12件すべて通りました");
  });

  it("still distinguishes a type check from an automated test run", () => {
    expect(beginnerOneLine(bash("test", "pnpm exec tsc --noEmit"))).toContain("型ルールで機械確認");
    expect(beginnerOneLine(bash("test", "pnpm exec vitest run"))).toContain("自動テストで機械的に確認");
  });

  it("falls back to the type-level line when the detail identifies nothing", () => {
    expect(beginnerOneLine(event("git"))).toBe("変更履歴を整理して戻せる状態にしています。");
  });
});
