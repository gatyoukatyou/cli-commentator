import type { RuleSet } from "./types.js";

export const claudeRuleset: RuleSet = {
  id: "claude",
  label: "Claude Code",
  detect: (line) => /^(⏺|•)\s*(Read|Update|Write|Bash)\(/.test(line),
  rules: [
    { id: "claude.read", priority: 100, re: /^[⏺•]\s*Read\(/, type: "read", summary: "ファイルを読み込んでいる" },
    { id: "claude.glob", priority: 95, re: /^[⏺•]\s*Glob\(/, type: "search", summary: "ファイル一覧を検索している" },
    { id: "claude.grep", priority: 92, re: /^[⏺•]\s*Grep\(/, type: "search", summary: "該当箇所を検索している" },
    { id: "claude.update", priority: 90, re: /^[⏺•]\s*Update\(/, type: "write", summary: "ファイルを更新している" },
    { id: "claude.edit", priority: 85, re: /^[⏺•]\s*Edit\(/, type: "write", summary: "ファイルを編集している" },
    { id: "claude.write", priority: 80, re: /^[⏺•]\s*Write\(/, type: "write", summary: "ファイルを書き込んでいる" },
    { id: "claude.bash", priority: 70, re: /^[⏺•]\s*Bash\(/, type: "stdout", summary: "コマンドを実行している" },

    { id: "claude.search", priority: 60, re: /\b(rg|grep)\b/i, type: "search", summary: "該当箇所を検索している" },
    { id: "claude.test", priority: 50, re: /\b(playwright|vitest|jest|test|typecheck|tsc)\b/i, type: "test", summary: "テスト/型チェックを実行している" },

    { id: "claude.github", priority: 40, re: /\bgh\s+(issue|pr|repo)\b/i, type: "github", summary: "GitHub操作をしている" },
    { id: "claude.git", priority: 30, re: /\bgit\s+(status|add|commit|push|pull|checkout|switch|merge|rebase)\b/i, type: "git", summary: "Git操作をしている" },

    { id: "claude.install", priority: 20, re: /\b(pnpm|npm|yarn)\s+(add|install|i|run)\b/i, type: "install", summary: "依存関係/スクリプトを処理している" },

    { id: "claude.readonly", priority: 12, re: /read[-\s]?only|write is disabled/i, type: "error", summary: "書き込みが制限されている" },
    { id: "claude.error", priority: 10, re: /execution error|error|failed|exception|TS\d{5}/i, type: "error", summary: "エラーが出ている" }
  ]
};
