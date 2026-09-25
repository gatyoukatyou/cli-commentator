import type { Event } from "../types.js";
import { createEscapeCarry } from "../terminal-escapes.js";
import type { Rule, RuleSet } from "./types.js";

/**
 * Hermes renders a full-screen terminal UI.  The extractor deliberately keeps
 * only state labels and tool categories; it never forwards the prompt,
 * assistant text, command arguments, paths, or status-bar contents.
 */
const HERMES_HEADER_RE = /^\s*(?:[┌┐└┘├┤┬┴┼─━│┃╭╮╰╯╠╣╦╩╬═║]+\s*)?Hermes\s+Agent\b(?:\s+v?[\d.]+)?/iu;
const HERMES_CLI_RE =
  /^\s*(?:[$❯>]\s*)?hermes\s+(?:--tui\b|chat\b|--continue\b|--resume\b|-c\b|-r\b|--yolo\b|-w\b)/iu;
const HERMES_START_RE = /^(?:starting|welcome to|connected to)\s+Hermes\b/iu;
const HERMES_SESSION_START_RE = /^(?:new session|session started)\b/iu;
const HERMES_TERMINAL_TOOL_RE =
  /^\s*(?:[┊│|]\s*)?(?:💻\s*)?(?:terminal|shell)\s+`/iu;
const HERMES_WEB_TOOL_RE =
  /^\s*(?:[┊│|]\s*)?(?:🔍\s*)?(?:web_search|web_extract|web)\b/iu;
const HERMES_SKILLS_TOOL_RE =
  /^\s*(?:[┊│|]\s*)?(?:📄\s*)?skills?\b/iu;
const HERMES_COMMAND_RE =
  /^\s*(?:running\s+\d+\s+shell\s+commands?|executing\s+(?:a\s+)?command|command\s+running|shell\s+command)\b/iu;
const HERMES_APPROVAL_RE =
  /^(?:\s*(?:[⚠!]\s*)?(?:(?:allow|approve|permission|approval|required|requires)\b.*(?:\?|\b(?:yes|no|y\/n)\b)|(?:approval|permission)\s+required\b.*|requires\s+approval\b.*)|\s*\[(?:y\/n|yes\/no)\]\s*$)/iu;
const HERMES_INTERRUPTED_RE =
  /^\s*(?:\^C|Ctrl\+C|␃|interrupted(?:\s+by\s+user)?|cancelled?(?:\s+by\s+user)?|canceled?(?:\s+by\s+user)?|operation\s+(?:cancelled|canceled))\b[.!]?/iu;
const HERMES_TURN_DONE_RE =
  /^\s*(?:[✓✔✅]\s*)?(?:turn|task|response)\s+(?:complete|completed|finished)\b/iu;
const HERMES_SESSION_DONE_RE =
  /(?:^\s*(?:session\s+ended|goodbye|exiting\s+Hermes)\b|resume\s+this\s+session\s+with:)/iu;
const HERMES_ERROR_RE =
  /^\s*(?:[✗✕❌⚠]\s*)?(?:(?:error|fatal|exception|traceback|api\s+error|authentication\s+failed)\b|(?:rate\s+limit\s+exceeded|no\s+api\s+key|connection\s+failed|command\s+failed)\b)/iu;
const HERMES_SLASH_RE =
  /^\s*(?:[❯>]\s*)?\/(?:new|reset|model|help|tools|skills|background|skin|voice|reasoning|title|status|context|sessions|verbose|usage|personality|worktree|busy|stop|quit|exit)\b/iu;
const HERMES_PROMPT_RE = /^\s*❯\s*$/u;
const HERMES_PROGRESS_RE =
  /^\s*(?:[^\p{L}\p{N}]*\s*)?(?:pondering|contemplating|got\s+it!|analyzing|formulating|brainstorming|reflecting|synthesizing|thinking|working)(?:\b|!).*(?:\.\.\.|…|\(\s*\d+(?:\.\d+)?s\s*\))/iu;

// Hermes' live TUI footer varies its spinner face, but the duration/model
// counter remains recognizable. These are status redraws, not assistant text.
const HERMES_STATUS_COUNTER_RE = /^\s*\d+\s*s\b.*\box\s+alpha\w*\b.*$/iu;
const HERMES_LIVE_STATUS_RE =
  /^\s*[^\p{L}\p{N}]*(?:analyzing|formulating|brainstorming|reflecting|synthesizing|pondering|contemplating|thinking|working)(?:\b|!).*(?:\.\.\.|…).*$/iu;

const HERMES_CHROME_RE =
  /^(?:\s*(?:\?\s+for\s+shortcuts|esc\s+to\s+interrupt|try\s+"|crunched\s+for|you've\s+used\s+\d+%|session:|duration:|messages:|model:|tools?:|skills?:|tokens?:|cost:|terminal\s+backend:|working\s+directory:|available\s+tools:|installed\s+skills:|resume\s+this\s+session\s+with:))/iu;
const HERMES_STATUS_BAR_RE = /^\s*⚕\s*[^│|]+[│|]/u;
const BOX_ONLY_RE = /^[\s┌┐└┘├┤┬┴┼─━│┃╭╮╰╯╠╣╦╩╬═║]+$/u;

// Hermes v0.20.x renders tool activity as emoji rows (`┊ 🔎 grep … 0.1s`,
// `💻 wc -l …`) that are frequently glued to a box-drawing separator run.
// Categories are collapsed at fingerprint level so a long session emits a
// handful of stage events instead of one event per tool call.
const HERMES_TOOLROW_SEARCH_RE = /^[─━│┊|\s]*[🔎🔍]\s*\S/u;
const HERMES_TOOLROW_READ_RE = /^[─━│┊|\s]*[📖📄]\s*\S/u;
const HERMES_TOOLROW_TERMINAL_RE = /^[─━│┊|\s]*💻\s*\S/u;
const HERMES_TOOLROW_GENERIC_RE = /^[─━│|\s]*┊\s*\S/u;

// The current task title is redrawn as a single `─` followed by the title
// (`─ TODO出現数と…`). The title text itself is never forwarded; only the
// fact that the agent moved to a different task is emitted.
const HERMES_TITLE_RE = /^─\s*(?=\p{L})/u;
const HERMES_TITLE_EXCLUDE_RE = /^(?:initializing|starting|connecting|loading)\b/iu;

// Thinking indicators use kaomoji prefixes (`( ͡° ͜ʖ ͡°) processing... (↓ 450
// tok)`). `[^A-Za-z]*` skips any non-ASCII decoration before the keyword.
const HERMES_THINKING_RE =
  /^[^A-Za-z]*(?:processing|pondering|thinking|working|searching|reading|exploring|summarizing|drafting|planning)\s*\.\.\./iu;

const HERMES_RULES: Rule[] = [
  {
    id: "hermes.session-start",
    priority: 150,
    re: HERMES_HEADER_RE,
    type: "start",
    summary: "Hermes Agentセッションを開始した",
  },
  {
    id: "hermes.start-banner",
    priority: 149,
    re: HERMES_START_RE,
    type: "start",
    summary: "Hermes Agentセッションを開始した",
  },
  {
    id: "hermes.cli",
    priority: 149,
    re: HERMES_CLI_RE,
    type: "start",
    summary: "Hermes Agentセッションを開始した",
  },
  {
    id: "hermes.session-started",
    priority: 148,
    re: HERMES_SESSION_START_RE,
    type: "start",
    summary: "Hermes Agentセッションを開始した",
  },
  {
    id: "hermes.session-done",
    priority: 145,
    re: HERMES_SESSION_DONE_RE,
    type: "done",
    summary: "Hermesセッションを終了した",
  },
  {
    id: "hermes.turn-done",
    priority: 144,
    re: HERMES_TURN_DONE_RE,
    type: "done",
    summary: "Hermesの応答が完了した",
  },
  {
    id: "hermes.error",
    priority: 140,
    re: HERMES_ERROR_RE,
    type: "error",
    summary: "Hermesでエラーが発生している",
  },
  {
    id: "hermes.interrupted",
    priority: 135,
    re: HERMES_INTERRUPTED_RE,
    type: "stdout",
    summary: "Hermesの処理を中断した",
  },
  {
    id: "hermes.approval",
    priority: 130,
    re: HERMES_APPROVAL_RE,
    type: "stdout",
    summary: "Hermesの承認を待っている",
  },
  {
    id: "hermes.slash",
    priority: 125,
    re: HERMES_SLASH_RE,
    type: "stdout",
    summary: "Hermesのスラッシュコマンドを実行している",
  },
  {
    id: "hermes.tool.terminal",
    priority: 120,
    re: HERMES_TERMINAL_TOOL_RE,
    type: "stdout",
    summary: "ターミナルツールを実行している",
  },
  {
    id: "hermes.tool.web",
    priority: 119,
    re: HERMES_WEB_TOOL_RE,
    type: "search",
    summary: "Webツールを実行している",
  },
  {
    id: "hermes.tool.skills",
    priority: 118,
    re: HERMES_SKILLS_TOOL_RE,
    type: "read",
    summary: "スキルを読み込んでいる",
  },
  {
    id: "hermes.toolrow.search",
    priority: 122,
    re: HERMES_TOOLROW_SEARCH_RE,
    type: "search",
    summary: "Hermesが検索を実行している",
  },
  {
    id: "hermes.toolrow.read",
    priority: 121,
    re: HERMES_TOOLROW_READ_RE,
    type: "read",
    summary: "Hermesがファイルを読んでいる",
  },
  {
    id: "hermes.toolrow.terminal",
    priority: 120,
    re: HERMES_TOOLROW_TERMINAL_RE,
    type: "stdout",
    summary: "Hermesがターミナルコマンドを実行している",
  },
  {
    id: "hermes.toolrow.generic",
    priority: 119,
    re: HERMES_TOOLROW_GENERIC_RE,
    type: "stdout",
    summary: "Hermesがツールを実行している",
  },
  {
    id: "hermes.command",
    priority: 115,
    re: HERMES_COMMAND_RE,
    type: "stdout",
    summary: "Hermesのコマンドを実行している",
  },
  {
    id: "hermes.title",
    priority: 112,
    re: HERMES_TITLE_RE,
    match: (line) => {
      if (!HERMES_TITLE_RE.test(line)) return false;
      if (HERMES_TITLE_EXCLUDE_RE.test(line)) return false;
      const body = line.replace(/^─\s*/u, "");
      return meaningfulCount(body) >= 6;
    },
    type: "stdout",
    summary: "Hermesが別の作業へ移った",
  },
  {
    id: "hermes.thinking",
    priority: 106,
    re: HERMES_THINKING_RE,
    type: "stdout",
    summary: "Hermesがモデル応答を生成している",
  },
  {
    id: "hermes.prompt",
    priority: 110,
    re: HERMES_PROMPT_RE,
    type: "stdout",
    summary: "Hermesの入力を待っている",
  },
  {
    id: "hermes.progress",
    priority: 105,
    re: HERMES_PROGRESS_RE,
    type: "stdout",
    summary: "Hermesがモデル応答を生成している",
  },
  {
    id: "hermes.response",
    priority: 40,
    re: /[\p{L}\p{N}]/u,
    match: (line) => isHermesResponseLine(line),
    type: "stdout",
    summary: "Hermesが応答をストリーミングしている",
  },
];

export const hermesRuleset: RuleSet = {
  id: "hermes",
  label: "Hermes Agent",
  detect: (line) => HERMES_HEADER_RE.test(line) || HERMES_START_RE.test(line) || HERMES_CLI_RE.test(line),
  rules: HERMES_RULES,
};

type HermesState = {
  cells: string[];
  col: number;
  pending: string;
  started: boolean;
  ended: boolean;
  waitingForInput: boolean;
  streaming: boolean;
  seenKeys: Set<string>;
  lastToolCategory: string | null;
};

const HERMES_BUFFER_LIMIT = 16_384;
const HERMES_SEEN_KEY_LIMIT = 128;
let escapeCarry = createEscapeCarry();
let state: HermesState = createState();

function createState(): HermesState {
  return {
    cells: [],
    col: 0,
    pending: "",
    started: false,
    ended: false,
    waitingForInput: false,
    streaming: false,
    seenKeys: new Set(),
    lastToolCategory: null,
  };
}

/**
 * Hermes redraws its live TUI region in place: the stream carries CSI
 * erase-line (`ESC[nK`), cursor-up (`ESC[nA`) and bare `CR` sequences between
 * the rendered rows. Stripping them blindly glues redraw residue onto the
 * next row, so the `┊ <emoji>` tool-row prefix never sits at the start of a
 * reconstructed line and every tool activity is missed.
 *
 * The builder emulates a single-line terminal instead: `CR` returns the
 * cursor to column 0 (subsequent characters overwrite), erase/cursor-up
 * sequences clear the partial line that the TUI is about to redraw, and `LF`
 * commits the line. Split sequences are repaired upstream by `escapeCarry`;
 * an incomplete tail is held back in `pending` the same way.
 */
type EscapeSequence = { end: number; params: string; final: string };

function parseEscapeAt(text: string, start: number): EscapeSequence | null {
  const intro = text[start + 1];
  if (intro === "[") {
    let j = start + 2;
    while (j < text.length && /[0-?]/.test(text[j])) j += 1;
    while (j < text.length && /[ -/]/.test(text[j])) j += 1;
    if (j >= text.length) return null;
    return { end: j + 1, params: text.slice(start + 2, j), final: text[j] };
  }
  if (intro === "]") {
    const bel = text.indexOf("\u0007", start);
    const st = text.indexOf("\u001B\\", start);
    let end = -1;
    if (bel >= 0 && (st < 0 || bel < st)) end = bel + 1;
    else if (st >= 0) end = st + 2;
    if (end < 0) return null;
    return { end, params: "", final: "osc" };
  }
  return { end: start + 2, params: "", final: "esc" };
}

function clearLine(): void {
  state.cells = [];
  state.col = 0;
}

function writeToLine(ch: string): void {
  while (state.cells.length < state.col) state.cells.push(" ");
  state.cells[state.col] = ch;
  state.col += 1;
}

function applyCsiToLine(params: string, final: string): void {
  const n = Number.parseInt(params, 10);
  switch (final) {
    case "K":
      // 0K erases from the cursor to end of line; 1K/2K erase the drawn line.
      if (params === "" || n === 0) state.cells = state.cells.slice(0, state.col);
      else clearLine();
      break;
    case "A":
    case "F":
    case "H":
      // The cursor moves up/home to redraw that region; the partial line is
      // about to be overwritten, so drop it.
      clearLine();
      break;
    case "G":
      state.col = Math.max(0, (Number.isNaN(n) ? 1 : n) - 1);
      break;
    case "J":
      if (params !== "" && n !== 0) clearLine();
      break;
    default:
      break;
  }
}

function pushChunkToLines(chunk: string): string[] {
  const text = state.pending + chunk;
  state.pending = "";
  const lines: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\u001B") {
      const seq = parseEscapeAt(text, i);
      if (!seq) {
        state.pending = text.slice(i);
        break;
      }
      if (seq.final !== "osc" && seq.final !== "esc") {
        applyCsiToLine(seq.params, seq.final);
      }
      i = seq.end;
      continue;
    }
    if (ch === "\r") {
      state.col = 0;
      i += 1;
      continue;
    }
    if (ch === "\n") {
      lines.push(state.cells.join(""));
      clearLine();
      i += 1;
      continue;
    }
    if (ch === "\t") {
      writeToLine(" ");
      writeToLine(" ");
      i += 1;
      continue;
    }
    if (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f) {
      i += 1;
      continue;
    }
    writeToLine(ch);
    i += 1;
  }
  if (state.cells.length > HERMES_BUFFER_LIMIT) {
    const dropped = state.cells.length - HERMES_BUFFER_LIMIT;
    state.cells = state.cells.slice(dropped);
    state.col = Math.max(0, state.col - dropped);
  }
  return lines;
}

function normalizeLine(line: string): string {
  return line.replace(/\t/g, " ").replace(/\s+/gu, " ").trim();
}

function meaningfulCount(line: string): number {
  return (line.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

function isHermesResponseLine(line: string): boolean {
  const normalized = normalizeLine(line);
  if (!normalized || BOX_ONLY_RE.test(normalized)) return false;
  if (HERMES_HEADER_RE.test(normalized) || HERMES_CHROME_RE.test(normalized)) return false;
  if (HERMES_STATUS_BAR_RE.test(normalized)) return false;
  if (HERMES_STATUS_COUNTER_RE.test(normalized) || HERMES_LIVE_STATUS_RE.test(normalized)) return false;
  if (HERMES_PROMPT_RE.test(normalized) || HERMES_SLASH_RE.test(normalized)) return false;
  if (/^[❯>]\s+/u.test(normalized)) return false;
  if (/^[┊│|┌┐└┘├┤┬┴┼─━╭╮╰╯╠╣╦╩╬═║]/u.test(normalized)) return false;
  if (/^(?:session\s+|duration\s+|messages\s+)/iu.test(normalized)) {
    return false;
  }
  return meaningfulCount(normalized) >= 8;
}

function matchRule(line: string): Rule | null {
  const normalized = normalizeLine(line);
  if (!normalized) return null;
  for (const rule of HERMES_RULES) {
    if (rule.match ? rule.match(normalized) : rule.re.test(normalized)) return rule;
  }
  return null;
}

function slashCommand(line: string): string {
  return line.match(/\/(?:new|reset|model|help|tools|skills|background|skin|voice|reasoning|title|status|context|sessions|verbose|usage|personality|worktree|busy|stop|quit|exit)\b/iu)?.[0].toLowerCase() ?? "/command";
}

function safeDetail(rule: Rule, line: string): string {
  switch (rule.id) {
    case "hermes.slash":
      return slashCommand(line);
    case "hermes.tool.terminal":
      return "terminal tool";
    case "hermes.tool.web":
      return "web tool";
    case "hermes.tool.skills":
      return "skills tool";
    case "hermes.toolrow.search":
      return "search tool";
    case "hermes.toolrow.read":
      return "read tool";
    case "hermes.toolrow.terminal":
      return "terminal tool";
    case "hermes.toolrow.generic":
      return "tool execution";
    case "hermes.title":
      return "task title changed";
    case "hermes.command":
      return "command execution";
    case "hermes.approval":
      return "approval prompt";
    case "hermes.interrupted":
      return "Ctrl+C interruption";
    case "hermes.error":
      return "Hermes error output";
    case "hermes.prompt":
      return "Hermes input prompt";
    case "hermes.progress":
    case "hermes.response":
      return "model response stream";
    case "hermes.session-done":
      return "Hermes session ended";
    case "hermes.turn-done":
      return "Hermes response completed";
    default:
      return "Hermes Agent session started";
  }
}

function fingerprint(rule: Rule, line: string): string {
  const normalized = normalizeLine(line).toLowerCase();
  if (rule.id === "hermes.response" || rule.id === "hermes.progress" || rule.id === "hermes.thinking") {
    return "response-stream";
  }
  if (rule.id === "hermes.prompt") return "input-prompt";
  if (rule.id === "hermes.session-start" || rule.id === "hermes.start-banner" || rule.id === "hermes.cli" || rule.id === "hermes.session-started") return "session-start";
  if (rule.id === "hermes.session-done" || rule.id === "hermes.turn-done") return rule.id;
  if (rule.id === "hermes.interrupted") return "interrupt";
  if (rule.id === "hermes.error") return "error";
  if (rule.id === "hermes.slash") return `slash:${slashCommand(normalized)}`;
  if (rule.id.startsWith("hermes.toolrow.")) return `${rule.id}:${normalized.slice(0, 120)}`;
  if (rule.id === "hermes.tool.terminal" || rule.id === "hermes.tool.web" || rule.id === "hermes.tool.skills") {
    return `${rule.id}:${normalized.slice(0, 160)}`;
  }
  return `${rule.id}:${normalized.replace(/\d+/gu, "#").slice(0, 160)}`;
}

function remember(key: string): boolean {
  if (state.seenKeys.has(key)) return false;
  state.seenKeys.add(key);
  if (state.seenKeys.size > HERMES_SEEN_KEY_LIMIT) {
    const first = state.seenKeys.values().next().value as string | undefined;
    if (first) state.seenKeys.delete(first);
  }
  return true;
}

function shouldEmit(rule: Rule, line: string): boolean {
  const key = fingerprint(rule, line);
  if (!remember(key)) return false;

  switch (rule.id) {
    case "hermes.session-start":
    case "hermes.start-banner":
    case "hermes.cli":
    case "hermes.session-started":
      state.started = true;
      state.ended = false;
      state.waitingForInput = false;
      state.streaming = false;
      return true;
    case "hermes.prompt":
      state.waitingForInput = true;
      state.streaming = false;
      state.lastToolCategory = null;
      return true;
    case "hermes.progress":
    case "hermes.response":
      state.waitingForInput = false;
      if (state.streaming) return false;
      state.streaming = true;
      return true;
    case "hermes.tool.terminal":
    case "hermes.tool.web":
    case "hermes.tool.skills":
    case "hermes.command":
      state.waitingForInput = false;
      state.streaming = false;
      return true;
    case "hermes.toolrow.search":
    case "hermes.toolrow.read":
    case "hermes.toolrow.terminal":
    case "hermes.toolrow.generic": {
      state.waitingForInput = false;
      state.streaming = false;
      // 同一カテゴリの連続ツール実行は実況せず、カテゴリが変わった時だけ
      // 通知する。87回のtool callが実況を溢れさせないようにするため。
      if (state.lastToolCategory === rule.id) return false;
      state.lastToolCategory = rule.id;
      return true;
    }
    case "hermes.title":
      state.waitingForInput = false;
      state.streaming = false;
      state.lastToolCategory = null;
      return true;
    case "hermes.slash":
      state.waitingForInput = false;
      state.streaming = false;
      return true;
    case "hermes.approval":
      state.waitingForInput = true;
      state.streaming = false;
      return true;
    case "hermes.interrupted":
      state.waitingForInput = true;
      state.streaming = false;
      return true;
    case "hermes.error":
      state.waitingForInput = false;
      state.streaming = false;
      return true;
    case "hermes.session-done":
      state.waitingForInput = false;
      state.streaming = false;
      state.ended = true;
      return true;
    case "hermes.turn-done":
      state.waitingForInput = false;
      state.streaming = false;
      return true;
    default:
      return true;
  }
}

function eventForLine(line: string, ts: number, provisional = false): Event | null {
  const normalized = normalizeLine(line);
  if (!normalized) return null;
  if (state.ended) return null;

  const rule = matchRule(normalized);
  if (!rule) return null;
  if (provisional && rule.id === "hermes.response" && meaningfulCount(normalized) < 12) return null;
  if (!shouldEmit(rule, normalized)) return null;

  return {
    ts,
    type: rule.type,
    summary: rule.summary,
    detail: safeDetail(rule, normalized),
  };
}

function shouldProcessProvisional(line: string): boolean {
  const normalized = normalizeLine(line);
  if (!normalized) return false;
  if (HERMES_HEADER_RE.test(normalized) || HERMES_CLI_RE.test(normalized)) return true;
  if (/^Hermes\b/iu.test(normalized)) return false;
  return Boolean(matchRule(normalized)) || isHermesResponseLine(normalized);
}

export function resetHermesExtractionState(): void {
  escapeCarry = createEscapeCarry();
  state = createState();
}

export function extractHermesEvents(chunk: string, ts = Date.now()): Event[] {
  const committed = pushChunkToLines(escapeCarry(chunk));

  const events: Event[] = [];
  for (const line of committed) {
    const event = eventForLine(line, ts);
    if (event) events.push(event);
  }

  const provisionalLine = state.cells.join("");
  if (provisionalLine && shouldProcessProvisional(provisionalLine)) {
    const event = eventForLine(provisionalLine, ts, true);
    if (event) events.push(event);
  }

  return events;
}
