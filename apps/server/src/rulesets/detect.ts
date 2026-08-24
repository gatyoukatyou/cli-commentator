import type { RuleSetId } from "./types.js";
import { ANSI_ESCAPE_RE } from "../terminal-escapes.js";

type Scores = { claude: number; codex: number; hermes: number };

type HermesSignal = "identity" | "cli" | "tool" | "tui" | "slash";

type LineScore = {
  scores: Scores;
  hermesSignals: HermesSignal[];
};

type DetectorOptions = {
  threshold?: number;
  maxLines?: number;
};

export const MAX_DETECT_LINES = 50;
export const MIN_DELTA = 4;
const STRONG_SCORE = 4;
const MEDIUM_SCORE = 2;
const WEAK_SCORE = 1;

const CLAUDE_STRONG = [
  /^(⏺|•)\s*(Read|Bash|Glob|Grep|Update|Write|Edit)\(/,
  /^⎿\s*\$\s*\S/u,
  /\bClaude Code\s*v\d+\.\d+\.\d+\b/iu,
];
const CLAUDE_MEDIUM = [
  /AskUserQuestion/i,
  /read[-\s]?only/i,
  /^⏺\s*(?!Read\(|Glob\(|Grep\(|Update\(|Edit\(|Write\(|Bash\()[\p{L}\p{N}]/u,
  /^Listed \d+ director(?:y|ies), ran \d+ shell commands?$/iu,
];

const CODEX_STRONG = [
  /\bOpenAI\s+Codex\s*\(v\d+\.\d+\.\d+\)/i,
  /would you like to run the following command\?/i,
  /you approved .* to run/i,
  /^(apply_patch|apply patch|\*\*\* Begin Patch\b)/i,
  /(?:^|\s)codex_core::.*\bToolCall:\s*(?:exec|exec_command|write_stdin|apply_patch|read_mcp_resource|update_plan)\b/i,
  /^ToolCall:\s*(?:exec|exec_command|write_stdin|apply_patch|read_mcp_resource|update_plan)\b/i
];
const CODEX_MEDIUM = [/^codex$/i, /\bcodex_core::/i];
const CODEX_WEAK = [/\bELIFECYCLE\b/i, /exit code/i];

// A bare `hermes` is common in prose, filenames, and unrelated applications.
// These patterns require the product name, an actual CLI invocation, or the
// distinctive tool-feed/TUI wording documented by Hermes itself. Detection
// still requires two independent signal families (see `decide`).
const HERMES_IDENTITY = [
  /\bHermes\s+Agent\b/iu,
  /(?:^|[\s"'(])hermes-agent(?:\s+(?:v?\d|cli|tui|session|agent)\b|$)/iu,
];
const HERMES_CLI = [
  /(?:^|[\s$>❯])hermes\s+(?:--tui\b|chat\b|--continue\b|--resume\b|-c\b|-r\b|--yolo\b|-w\b)/iu,
  /\bhermes\s+chat\s+-q\b/iu,
];
const HERMES_TOOL = [
  /(?:^|[┊│|])\s*(?:💻\s*)?terminal\s+`/iu,
  /(?:^|[┊│|])\s*(?:🔍\s*)?(?:web_search|web_extract)\b/iu,
  /(?:^|[┊│|])\s*(?:📄\s*)?skills?\b/iu,
];
const HERMES_TUI = [
  /\b(?:terminal backend|working directory|available tools|installed skills)\b/iu,
  /^\s*[│┃]?\s*(?:tools|skills):\s*(?:terminal|web|skills?)/iu,
  /\b(?:pondering|contemplating|got it!)\b.*\(\s*\d+(?:\.\d+)?s\s*\)/iu,
  /⚕\s*[^│|]+[│|].*\b(?:tokens?|context|duration)\b/iu,
  /^\s*⚕\s*[^│|]+[│|]/iu,
];
const HERMES_SLASH = [
  /^\s*(?:[❯>]\s*)?\/(?:new|reset|model|help|tools|skills|background|skin|voice|reasoning|title|status|context|sessions|verbose|usage|personality|worktree|busy|stop|quit|exit)\b/iu,
];

/**
 * The launcher knows the executable that owns the PTY. An exact Hermes
 * executable name is a stronger signal than a bare word in captured output,
 * so it may seed auto mode before the TUI paints its first frame.
 */
export function detectSourceFromCommand(cmd: string): RuleSetId | null {
  const executable = cmd.trim().replaceAll("\\", "/").split("/").pop()?.toLowerCase();
  return executable === "hermes" || executable === "hermes-agent" ? "hermes" : null;
}

function scoreLine(line: string): LineScore {
  let claude = 0;
  let codex = 0;
  let hermes = 0;
  const hermesSignals = new Set<HermesSignal>();

  for (const re of CLAUDE_STRONG) {
    if (re.test(line)) claude += STRONG_SCORE;
  }
  for (const re of CLAUDE_MEDIUM) {
    if (re.test(line)) claude += MEDIUM_SCORE;
  }

  for (const re of CODEX_STRONG) {
    if (re.test(line)) codex += STRONG_SCORE;
  }
  for (const re of CODEX_MEDIUM) {
    if (re.test(line)) codex += MEDIUM_SCORE;
  }
  for (const re of CODEX_WEAK) {
    if (re.test(line)) codex += WEAK_SCORE;
  }

  if (HERMES_IDENTITY.some((re) => re.test(line))) {
    hermes += STRONG_SCORE;
    hermesSignals.add("identity");
  }
  if (HERMES_CLI.some((re) => re.test(line))) {
    hermes += STRONG_SCORE;
    hermesSignals.add("cli");
  }
  if (HERMES_TOOL.some((re) => re.test(line))) {
    hermes += STRONG_SCORE;
    hermesSignals.add("tool");
  }
  if (HERMES_TUI.some((re) => re.test(line))) {
    hermes += MEDIUM_SCORE;
    hermesSignals.add("tui");
  }
  if (HERMES_SLASH.some((re) => re.test(line))) {
    hermes += MEDIUM_SCORE;
    hermesSignals.add("slash");
  }

  return { scores: { claude, codex, hermes }, hermesSignals: [...hermesSignals] };
}

function normalizeSignalLine(line: string): string {
  return line
    .replace(ANSI_ESCAPE_RE, " ")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function decide(scores: Scores, threshold: number, hermesSignals: ReadonlySet<HermesSignal>): RuleSetId | null {
  const hermesEligible =
    hermesSignals.size >= 2 &&
    (["identity", "cli", "tool"] as const).some((signal) => hermesSignals.has(signal));
  const candidates: Array<[RuleSetId, number]> = [
    ["claude", scores.claude],
    ["codex", scores.codex],
  ];
  if (hermesEligible) candidates.push(["hermes", scores.hermes]);

  candidates.sort(([, scoreA], [, scoreB]) => scoreB - scoreA);
  const winner = candidates[0];
  const runnerUp = candidates[1];
  if (!winner || !runnerUp || winner[1] - runnerUp[1] < threshold) return null;
  return winner[0];
}

export function createAutoDetector(options: DetectorOptions = {}) {
  const threshold = options.threshold ?? MIN_DELTA;
  const maxLines = options.maxLines ?? MAX_DETECT_LINES;

  let detected: RuleSetId | null = null;
  let scores: Scores = { claude: 0, codex: 0, hermes: 0 };
  const hermesSignals = new Set<HermesSignal>();
  let seen = 0;

  function update(line: string): RuleSetId | null {
    if (detected) return detected;

    const delta = scoreLine(line);
    scores = {
      claude: scores.claude + delta.scores.claude,
      codex: scores.codex + delta.scores.codex,
      hermes: scores.hermes + delta.scores.hermes,
    };
    for (const signal of delta.hermesSignals) hermesSignals.add(signal);
    seen += 1;

    const decided = decide(scores, threshold, hermesSignals);
    if (decided) {
      detected = decided;
      return detected;
    }

    if (seen >= maxLines) {
      detected = "generic";
      return detected;
    }

    return null;
  }

  function get(): RuleSetId | null {
    return detected;
  }

  function reset() {
    detected = null;
    scores = { claude: 0, codex: 0, hermes: 0 };
    hermesSignals.clear();
    seen = 0;
  }

  return { update, get, reset };
}

export function detectSourceFromText(text: string, options: DetectorOptions = {}): RuleSetId {
  const detector = createAutoDetector(options);
  const lines = text.split(/\r?\n/).map(normalizeSignalLine).filter(Boolean);
  for (const line of lines) {
    const decided = detector.update(line);
    if (decided) return decided;
  }
  return detector.get() ?? "generic";
}
