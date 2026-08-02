import type { RuleSetId } from "./types.js";
import { ANSI_ESCAPE_RE } from "../terminal-escapes.js";

type Scores = { claude: number; codex: number };

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

function scoreLine(line: string): Scores {
  let claude = 0;
  let codex = 0;

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

  return { claude, codex };
}

function normalizeSignalLine(line: string): string {
  return line
    .replace(ANSI_ESCAPE_RE, " ")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function decide(scores: Scores, threshold: number): RuleSetId | null {
  const diff = Math.abs(scores.claude - scores.codex);
  if (diff < threshold) return null;
  return scores.claude > scores.codex ? "claude" : "codex";
}

export function createAutoDetector(options: DetectorOptions = {}) {
  const threshold = options.threshold ?? MIN_DELTA;
  const maxLines = options.maxLines ?? MAX_DETECT_LINES;

  let detected: RuleSetId | null = null;
  let scores: Scores = { claude: 0, codex: 0 };
  let seen = 0;

  function update(line: string): RuleSetId | null {
    if (detected) return detected;

    const delta = scoreLine(line);
    scores = {
      claude: scores.claude + delta.claude,
      codex: scores.codex + delta.codex
    };
    seen += 1;

    const decided = decide(scores, threshold);
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
    scores = { claude: 0, codex: 0 };
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
