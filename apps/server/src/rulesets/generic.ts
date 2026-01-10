import type { RuleSet } from "./types.js";

export const genericRuleset: RuleSet = {
  id: "generic",
  label: "Generic",
  rules: [
    { id: "generic.search", priority: 60, re: /\b(rg|grep)\b/i, type: "search", summary: "該当箇所を検索している" },
    { id: "generic.test", priority: 50, re: /\b(playwright|vitest|jest|test|typecheck|tsc)\b/i, type: "test", summary: "テスト/型チェックを実行している" },

    { id: "generic.github", priority: 40, re: /\bgh\s+(issue|pr|repo)\b/i, type: "github", summary: "GitHub操作をしている" },
    { id: "generic.git", priority: 30, re: /\bgit\s+(status|add|commit|push|pull|checkout|switch|merge|rebase)\b/i, type: "git", summary: "Git操作をしている" },

    { id: "generic.install", priority: 20, re: /\b(pnpm|npm|yarn)\s+(add|install|i|run)\b/i, type: "install", summary: "依存関係/スクリプトを処理している" },

    { id: "generic.error", priority: 10, re: /execution error|error|failed|exception|TS\d{5}/i, type: "error", summary: "エラーが出ている" }
  ]
};
