import type { Event, EventType } from "./types.js";

// Claude Code / Codex系ログ寄せのルール
const RULES: Array<{ re: RegExp; type: EventType; summary: string }> = [
  { re: /^[⏺•]\s*Read\(/, type: "read", summary: "ファイルを読み込んでいる" },
  { re: /^[⏺•]\s*Update\(/, type: "write", summary: "ファイルを更新している" },
  { re: /^[⏺•]\s*Write\(/, type: "write", summary: "ファイルを書き込んでいる" },
  { re: /^[⏺•]\s*Bash\(/, type: "stdout", summary: "コマンドを実行している" },

  { re: /\b(rg|grep)\b/i, type: "search", summary: "該当箇所を検索している" },
  { re: /\b(playwright|vitest|jest|test|typecheck|tsc)\b/i, type: "test", summary: "テスト/型チェックを実行している" },

  { re: /\bgh\s+(issue|pr|repo)\b/i, type: "github", summary: "GitHub操作をしている" },
  { re: /\bgit\s+(status|add|commit|push|pull|checkout|switch|merge|rebase)\b/i, type: "git", summary: "Git操作をしている" },

  { re: /\b(pnpm|npm|yarn)\s+(add|install|i|run)\b/i, type: "install", summary: "依存関係/スクリプトを処理している" },

  { re: /execution error|error|failed|exception|TS\d{5}/i, type: "error", summary: "エラーが出ている" }
];

export function extractEvents(chunk: string): Event[] {
  const ts = Date.now();
  const lines = chunk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const events: Event[] = [];
  for (const line of lines) {
    const hit = RULES.find((r) => r.re.test(line));
    if (hit) events.push({ ts, type: hit.type, summary: hit.summary, detail: line });
    else events.push({ ts, type: "stdout", summary: "ログ更新", detail: line });
  }
  return events;
}
