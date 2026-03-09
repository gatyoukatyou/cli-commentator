export type CommentaryTextParts = {
  mainText: string;
  memoText: string | null;
  noteText: string | null;
};

const RAW_DETAIL_MAX_LENGTH = 180;

const TRAILING_NOTE_RE = /\s（([^（）]+)）$/u;
const ONE_LINE_MEMO_MARKER = "1行メモ:";

export function splitGlossaryNote(text: string): CommentaryTextParts {
  const normalized = text.trim();
  const match = normalized.match(TRAILING_NOTE_RE);
  const textWithoutNote = match ? normalized.slice(0, match.index).trim() : normalized;
  const noteText = match?.[1]?.trim() || null;

  const memoIndex = textWithoutNote.indexOf(ONE_LINE_MEMO_MARKER);
  if (memoIndex < 0) {
    return { mainText: textWithoutNote, memoText: null, noteText };
  }

  const mainText = textWithoutNote.slice(0, memoIndex).trim();
  const memoText = textWithoutNote.slice(memoIndex + ONE_LINE_MEMO_MARKER.length).trim();

  if (!mainText || !memoText) {
    return { mainText: textWithoutNote, memoText: null, noteText };
  }

  return { mainText, memoText, noteText };
}

const compactRawDetail = (rawDetail?: string): string | null => {
  if (!rawDetail) return null;
  const compact = rawDetail.trim().replace(/\s+/g, " ");
  if (!compact) return null;
  return compact.length > RAW_DETAIL_MAX_LENGTH ? `${compact.slice(0, RAW_DETAIL_MAX_LENGTH)}...` : compact;
};

export function buildSpeechText(text: string, repeatCount = 1, rawDetail?: string): string {
  const parts = splitGlossaryNote(text);
  const segments = repeatCount > 1 ? [parts.mainText] : [parts.mainText, parts.memoText ?? ""];
  const rawSegment = compactRawDetail(rawDetail);
  if (rawSegment) {
    segments.push(`原文 ${rawSegment}`);
  }
  return segments
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce((combined, segment) => {
      if (!combined) return segment;
      const needsSeparator = !/[。！？!?]$/u.test(combined);
      return `${combined}${needsSeparator ? "。 " : " "}${segment}`;
    }, "");
}
