import type { Event } from "./protocol.js";

type UrgentEvent = Pick<Event, "summary" | "detail">;

const APPROVAL_PROMPT_RE = /would you like to run the following command\?/iu;
const QUESTION_RE = /Question\s+(\d+)\/\d+\s+\((?:[1-9]\d*) unanswered\)/iu;
const COMMAND_START_RE =
  /^(?:(?:sudo|command|env)\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:pnpm|npm|yarn|bun|npx|node|git|gh|cargo|docker|make|go|python\d*|deno|rm|mv|cp|mkdir|chmod|curl)\b/iu;

function commandName(value: string): string {
  return value.replace(/\\/g, "/").split("/").at(-1)?.toLowerCase() ?? value.toLowerCase();
}

function commandLine(detail: string): string | null {
  const lines = detail.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const promptAt = lines.findIndex((line) => APPROVAL_PROMPT_RE.test(line));
  if (promptAt < 0) return null;

  for (const line of lines.slice(promptAt + 1, promptAt + 6)) {
    const candidate = line.replace(/^(?:[$›❯>]\s*)+/u, "").trim();
    if (COMMAND_START_RE.test(candidate)) return candidate;
  }
  return null;
}

function tokenizeCommand(command: string): string[] {
  return command.match(/(?:[^\s"'`]+|["'`][^"'`]*["'`])/gu)?.map((token) =>
    token.replace(/^(["'`])|(["'`])$/gu, "")
  ) ?? [];
}

function commandSummary(command: string): string | null {
  const tokens = tokenizeCommand(command);
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[index])) index += 1;
  if (["sudo", "command", "env"].includes(commandName(tokens[index] ?? ""))) index += 1;

  const executable = commandName(tokens[index] ?? "");
  if (!executable) return null;
  index += 1;

  const valueOptions = new Set(["-C", "--dir", "--filter", "-w", "--workspace", "--prefix", "--cwd"]);
  while (index < tokens.length && tokens[index].startsWith("-")) {
    const option = tokens[index];
    index += 1;
    if (valueOptions.has(option)) index += 1;
  }

  let action = tokens[index]?.toLowerCase();
  if (["pnpm", "npm", "yarn", "bun"].includes(executable) && action === "run") {
    action = tokens[index + 1]?.toLowerCase();
  } else if (["pnpm", "npm", "yarn", "bun"].includes(executable) && action === "exec") {
    action = commandName(tokens[index + 1] ?? "");
  }

  if (["pnpm", "npm", "yarn", "bun", "npx"].includes(executable)) {
    if (action && /^test(?::|$)|^(?:vitest|jest|playwright)$/iu.test(action)) return "テスト";
    if (action && /^(?:typecheck|tsc)$/iu.test(action)) return "型チェック";
    if (action && /^lint(?::|$)/iu.test(action)) return "リント";
    if (action && /^build(?::|$)/iu.test(action)) return "ビルド";
    if (action && /^(?:add|install|i)$/iu.test(action)) return "依存関係の準備";
  }
  if (executable === "git") {
    if (action === "push") return "変更の共有";
    if (action === "commit") return "変更の記録";
    return "Git操作";
  }
  if (executable === "gh") return "GitHub操作";
  if (["rm", "rmdir"].includes(executable)) return "ファイル削除";
  if (["mv", "cp"].includes(executable)) return "ファイル整理";
  if (executable === "mkdir") return "フォルダ作成";
  if (executable === "chmod") return "権限変更";
  if (action && /^[a-z0-9][a-z0-9:._-]*$/iu.test(action)) {
    return `${executable}操作`;
  }
  return "コマンド操作";
}

export function buildUrgentSpeechText(event: UrgentEvent): string {
  const detail = event.detail ?? "";
  if (event.summary === "コマンド実行の確認待ち" || APPROVAL_PROMPT_RE.test(detail)) {
    const command = commandLine(detail);
    const summary = command ? commandSummary(command) : null;
    return summary
      ? `要対応です：「${summary}」の実行許可を求めています。`
      : "要対応です：コマンドの実行許可を求めています。";
  }

  if (event.summary === "質問への回答を待っている") {
    const questionNumber = detail.match(QUESTION_RE)?.[1];
    return questionNumber
      ? `要対応です：質問${questionNumber}への回答を求めています。`
      : "要対応です：質問への回答を求めています。";
  }

  return `要対応です：${event.summary.replace(/[。.!！]+$/u, "")}。`;
}
