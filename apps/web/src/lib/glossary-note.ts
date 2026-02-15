export type CommentaryTextParts = {
  mainText: string;
  noteText: string | null;
};

const TRAILING_NOTE_RE = /\s（([^（）]+)）$/u;

export function splitGlossaryNote(text: string): CommentaryTextParts {
  const normalized = text.trim();
  const match = normalized.match(TRAILING_NOTE_RE);
  if (!match) {
    return { mainText: normalized, noteText: null };
  }

  const mainText = normalized.slice(0, match.index).trim();
  const noteText = match[1]?.trim();

  if (!mainText || !noteText) {
    return { mainText: normalized, noteText: null };
  }

  return { mainText, noteText };
}
