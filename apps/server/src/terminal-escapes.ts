/**
 * Terminal escape sequence stripping, shared by the extractor and the Claude
 * supervision ruleset so the two cannot diverge.
 *
 * The OSC alternative (`ESC ] ... BEL`) must come first. The two-character
 * escape class was previously written `[@-Z\\-_]`, where `\\-_` is a *range*
 * from `\` (0x5C) to `_` (0x5F) and therefore contains `]` (0x5D). `ESC ]` then
 * matched as a two-character escape, consuming only the introducer and leaving
 * the OSC body behind — so every terminal-title update leaked into the log as
 * `0;⠂ List files in docs folder` and was read aloud verbatim.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters by definition.
export const ANSI_ESCAPE_RE =
  /\u001B(?:\][^\u0007]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~]|[()*+][0-2A-Z]|[0-~])/g;

export function stripTerminalEscapes(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "");
}

const ESC = "\u001B";
const BEL = "\u0007";
/** Long enough for any real sequence, short enough that a stray ESC cannot stall the stream. */
const MAX_CARRY = 256;

/**
 * Index at which an escape sequence starts but does not finish inside `text`,
 * or -1 when the tail is complete.
 */
function incompleteEscapeStart(text: string): number {
  const start = text.lastIndexOf(ESC);
  if (start < 0) return -1;

  const rest = text.slice(start);
  if (rest.length === 1) return start;

  switch (rest[1]) {
    case "[":
      // CSI: parameter and intermediate bytes until a final byte 0x40–0x7E.
      return /^\[[0-?]*[ -/]*[@-~]/.test(rest) ? -1 : start;
    case "]":
      // OSC: terminated by BEL or ST.
      return rest.includes(BEL) || rest.includes(`${ESC}\\`) ? -1 : start;
    case "(":
    case ")":
    case "*":
    case "+":
      return rest.length >= 3 ? -1 : start;
    default:
      return -1;
  }
}

/**
 * A PTY delivers arbitrary byte chunks, so an escape sequence can be split
 * across two `onData` callbacks. Stripping each chunk independently then leaves
 * the tail behind as text — the log fills with fragments like `40;1H`, `[22` or
 * `0;⠂ List files in docs folder`, and the commentary reads them aloud.
 *
 * Returns a function that holds back an unfinished trailing sequence and
 * prepends it to the next chunk.
 */
export function createEscapeCarry(): (chunk: string) => string {
  let pending = "";

  return (chunk: string) => {
    const text = pending + chunk;
    pending = "";

    const start = incompleteEscapeStart(text);
    if (start < 0) return text;
    if (text.length - start > MAX_CARRY) return text;

    pending = text.slice(start);
    return text.slice(0, start);
  };
}
