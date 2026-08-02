export function isTerminalRenderingNoise(text: string): boolean {
  const compact = text.replace(/\s+/gu, "").trim();
  if (!compact) return true;

  return (
    /^(?:\(B|\d{1,3}[A-Z]?|[A-Za-z]\d{2,3})(?:\s+(?:\(B|\d{1,3}[A-Z]?|[A-Za-z]\d{2,3}))+$/u.test(
      text.trim()
    ) ||
    /^\([A-Z0-2]$/u.test(compact) ||
    /^\d{1,3}[A-Z]?$/u.test(compact) ||
    /^[A-Za-z]\d{2,3}$/u.test(compact) ||
    /^[.•·]+\d*$/u.test(compact) ||
    /^[A-Za-z][A-Za-z]{1,24}(?:…|\.{3})\d+s?$/u.test(compact) ||
    !/[\p{L}\p{N}]/u.test(compact)
  );
}

/**
 * Claude Code repaints its whole frame many times a second. Each repaint is
 * delivered as ordinary output, so the extractor turns spinner glyphs, the
 * animated status word and the token counter into `stdout` events — which the
 * commentary then reads aloud as
 * `今見えている出力は「✻(2s · ↓4 tokens)」です。`
 *
 * These are the decorations, removed before judging whether anything was said.
 */
const CLAUDE_SPINNER_GLYPHS = /[✢-✧✱-✿⏺⏸❯⎽]/gu;
const BOX_DRAWING = /[─-▟]/gu;
const BRAILLE_SPINNER = /[⠀-⣿]/gu;
// No `\b`: a repaint often glues the word to the previous counter (`✽37Lollygagging…`),
// and there is no word boundary between a digit and a letter.
/** The animated status word, e.g. `Lollygagging…`, `Catapulting…`, `Herding…`. */
const SPINNER_WORD = /[A-Za-z]{3,24}(?:…|\.{3})/gu;
/** `(2s · ↓8 tokens)`, `(13s · ↓618 tokens)`, and the fragments repaints leave. */
const TOKEN_COUNTER = /\(?\s*\d+\s*s?\s*[·•]?\s*[↑↓]?\s*[\d.]+\s*k?\s*tokens?\s*\)?/giu;
/** Persistent footer/help chrome that never describes what the AI is doing. */
const STATUS_CHROME =
  /esc to interrupt|\? for shortcuts|manual mode on|Try "[^"]*"|You've used \d+% of your weekly limit|run \/login to renew|Crunched for \d+s|connecting…/giu;

/** Letters and CJK only; stray digits left by a repaint are not content. */
function meaningfulLength(text: string): number {
  return (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{L}]/gu) ?? []).length;
}

const MIN_MEANINGFUL_CHARS = 8;

export function isClaudeTuiNoise(text: string): boolean {
  const residue = text
    .replace(STATUS_CHROME, " ")
    .replace(TOKEN_COUNTER, " ")
    .replace(SPINNER_WORD, " ")
    .replace(CLAUDE_SPINNER_GLYPHS, " ")
    .replace(BOX_DRAWING, " ")
    .replace(BRAILLE_SPINNER, " ")
    .replace(/\s+/gu, " ")
    .trim();

  return meaningfulLength(residue) < MIN_MEANINGFUL_CHARS;
}

export function isCodexProgressNoise(text: string): boolean {
  return (
    /^working\s*\(\d+s\s*[•·]\s*esc to interrupt\)$/i.test(text) ||
    /^\d+s\s*[•·]\s*esc to interrupt\)?$/i.test(text) ||
    /^[a-z]$/i.test(text) ||
    /^\d+[;?]+$/i.test(text) ||
    /^[.•·]\d+$/i.test(text)
  );
}

export function isCodexTuiAssistantLine(text: string): boolean {
  const match = text.match(/^•\s+(.+)$/u);
  if (!match) return false;

  const message = match[1].trim();
  if (
    /^(?:Ran|Working|Booting MCP|Starting MCP|MCP servers?|Usage status)\b/iu.test(message) ||
    /esc to interrupt|Write tests for @filename/iu.test(message)
  ) {
    return false;
  }

  const meaningful = message.match(/[\p{L}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? [];
  return meaningful.length >= 8;
}
