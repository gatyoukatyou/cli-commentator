import type { RuleSet } from "./types.js";

export const codexRuleset: RuleSet = {
  id: "codex",
  label: "Codex",
  detect: (line) => /\bcodex\b|\bapply_patch\b/i.test(line),
  rules: [
    { id: "codex.read", priority: 100, re: /^[⏺•]\s*Read\(/, type: "read", summary: "ファイルを読み込んでいる" },
    { id: "codex.update", priority: 90, re: /^[⏺•]\s*Update\(/, type: "write", summary: "ファイルを更新している" },
    { id: "codex.write", priority: 80, re: /^[⏺•]\s*Write\(/, type: "write", summary: "ファイルを書き込んでいる" },
    { id: "codex.patch", priority: 75, re: /\bapply_patch\b|apply patch/i, type: "write", summary: "パッチを適用している" },
    { id: "codex.bash", priority: 70, re: /^[⏺•]\s*Bash\(/, type: "stdout", summary: "コマンドを実行している" },

    { id: "codex.search", priority: 60, re: /\b(rg|grep)\b/i, type: "search", summary: "該当箇所を検索している" },
    { id: "codex.test", priority: 50, re: /\b(playwright|vitest|jest|test|typecheck|tsc)\b/i, type: "test", summary: "テスト/型チェックを実行している" },

    { id: "codex.github", priority: 40, re: /\bgh\s+(issue|pr|repo)\b/i, type: "github", summary: "GitHub操作をしている" },
    { id: "codex.git", priority: 30, re: /\bgit\s+(status|add|commit|push|pull|checkout|switch|merge|rebase)\b/i, type: "git", summary: "Git操作をしている" },

    { id: "codex.install", priority: 20, re: /\b(pnpm|npm|yarn)\s+(add|install|i|run)\b/i, type: "install", summary: "依存関係/スクリプトを処理している" },

    { id: "codex.error", priority: 10, re: /execution error|error|failed|exception|TS\d{5}/i, type: "error", summary: "エラーが出ている" }
  ]
};
