import type { RuleSet } from "./types.js";
import { isFileListExecution, isSearchExecution, isTestExecution } from "../command-analysis.js";

const CLAUDE_COMMAND_RE = /^⎿\s*\$\s*\S/u;
const CLAUDE_ASSISTANT_RE = /^⏺\s*(?!Read\(|Glob\(|Grep\(|Update\(|Edit\(|Write\(|Bash\()[\p{L}\p{N}]/u;
const CLAUDE_SUMMARY_RE = /^Listed \d+ director(?:y|ies), ran \d+ shell commands?$/iu;
const CLAUDE_CURRENT_ERROR_RE =
  /\b(?:execution error|uncaught exception|failed with exit code|command not found)\b|^(?:command|process|build|test) failed\b|^(?:error|failed|exception):\s|^\s*(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*(?:Error|Exception):\s|^(?:tests?|test files?|suites?|specs?)\b[^\n]*?\b(?!0+\b)\d+\s+failed\b|\bproblems?\s*\(\s*(?!0+\b)\d+\s+errors?\b|\bexited with (?:code|status)\s+(?!0+\b)\d+\b|\bTS\d{4,5}:/i;

export const claudeRuleset: RuleSet = {
  id: "claude",
  label: "Claude Code",
  detect: (line) =>
    /^(⏺|•)\s*(Read|Update|Write|Bash)\(/.test(line) || CLAUDE_COMMAND_RE.test(line),
  rules: [
    { id: "claude.permission", priority: 130, re: /requires approval|do you want to proceed\?|trust this folder/i, type: "stdout", summary: "許可を待っている" },
    { id: "claude.question", priority: 125, re: /enter to select|which .* do you (?:choose|prefer)/i, type: "stdout", summary: "質問への回答を待っている" },
    { id: "claude.completion", priority: 120, re: /(?:^|[.!?]\s+)(?:the )?(?:task|work) is complete\.?$/i, type: "done", summary: "作業が完了した" },
    { id: "claude.exit-error", priority: 115, re: /failed with exit code|command not found/i, type: "error", summary: "エラーが発生している" },
    { id: "claude.command.file-list", priority: 110, re: CLAUDE_COMMAND_RE, match: (line) => CLAUDE_COMMAND_RE.test(line) && isFileListExecution(line), type: "search", summary: "ファイル一覧を検索している" },
    { id: "claude.command.search", priority: 108, re: CLAUDE_COMMAND_RE, match: (line) => CLAUDE_COMMAND_RE.test(line) && isSearchExecution(line), type: "search", summary: "該当箇所を検索している" },
    { id: "claude.command.test", priority: 106, re: CLAUDE_COMMAND_RE, match: (line) => CLAUDE_COMMAND_RE.test(line) && isTestExecution(line), type: "test", summary: "テスト/型チェックを実行している" },
    { id: "claude.read", priority: 100, re: /^[⏺•]\s*Read\(/, type: "read", summary: "ファイルを読み込んでいる" },
    { id: "claude.glob", priority: 95, re: /^[⏺•]\s*Glob\(/, type: "search", summary: "ファイル一覧を検索している" },
    { id: "claude.grep", priority: 92, re: /^[⏺•]\s*Grep\(/, type: "search", summary: "該当箇所を検索している" },
    { id: "claude.update", priority: 90, re: /^[⏺•]\s*Update\(/, type: "write", summary: "ファイルを更新している" },
    { id: "claude.edit", priority: 85, re: /^[⏺•]\s*Edit\(/, type: "write", summary: "ファイルを編集している" },
    { id: "claude.write", priority: 80, re: /^[⏺•]\s*Write\(/, type: "write", summary: "ファイルを書き込んでいる" },
    { id: "claude.bash", priority: 70, re: /^[⏺•]\s*Bash\(/, type: "stdout", summary: "コマンドを実行している" },
    { id: "claude.assistant", priority: 65, re: CLAUDE_ASSISTANT_RE, type: "stdout", summary: "Claudeが説明している" },
    { id: "claude.summary", priority: 64, re: CLAUDE_SUMMARY_RE, type: "stdout", summary: "作業結果を要約している" },

    { id: "claude.search", priority: 60, re: /\b(rg|grep)\b/i, match: isSearchExecution, type: "search", summary: "該当箇所を検索している" },
    { id: "claude.test", priority: 50, re: /\b(playwright|vitest|jest|test|typecheck|tsc)\b/i, match: isTestExecution, type: "test", summary: "テスト/型チェックを実行している" },

    { id: "claude.github", priority: 40, re: /\bgh\s+(issue|pr|repo)\b/i, type: "github", summary: "GitHub操作をしている" },
    { id: "claude.git", priority: 30, re: /\bgit\s+(status|add|commit|push|pull|checkout|switch|merge|rebase)\b/i, type: "git", summary: "Git操作をしている" },

    { id: "claude.install", priority: 20, re: /\b(pnpm|npm|yarn)\s+(add|install|i|run)\b/i, type: "install", summary: "依存関係/スクリプトを処理している" },
    { id: "claude.command", priority: 15, re: CLAUDE_COMMAND_RE, type: "stdout", summary: "コマンドを実行している" },

    { id: "claude.readonly", priority: 12, re: /\bread[-\s]?only mode\b|\bwrite is disabled\b/i, type: "error", summary: "書き込みが制限されている" },
    { id: "claude.error", priority: 10, re: CLAUDE_CURRENT_ERROR_RE, type: "error", summary: "エラーが出ている" }
  ]
};
