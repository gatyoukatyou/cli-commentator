import type { CommentaryDisplayMode, CommentaryPayload, CommentarySpeech } from "../types";

export type CommentaryTextParts = {
  narrationText: string | null;
  explanationText: string | null;
  glossaryNotes: string[];
};

const RAW_DETAIL_MAX_LENGTH = 180;
const TRAILING_NOTE_RE = /\s（([^（）]+)）$/u;
const ONE_LINE_MEMO_MARKER = "1行メモ:";

function normalizeText(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function uniqueNotes(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function parseLegacyCommentaryText(text: string): CommentaryTextParts {
  const normalized = text.trim();
  if (!normalized) {
    return { narrationText: null, explanationText: null, glossaryNotes: [] };
  }

  const match = normalized.match(TRAILING_NOTE_RE);
  const textWithoutNote = match ? normalized.slice(0, match.index).trim() : normalized;
  const glossaryNotes = uniqueNotes(match?.[1]?.split(" / ") ?? []);

  const memoIndex = textWithoutNote.indexOf(ONE_LINE_MEMO_MARKER);
  if (memoIndex < 0) {
    return { narrationText: textWithoutNote, explanationText: null, glossaryNotes };
  }

  const narrationText = normalizeText(textWithoutNote.slice(0, memoIndex));
  const explanationText = normalizeText(textWithoutNote.slice(memoIndex + ONE_LINE_MEMO_MARKER.length));

  if (!narrationText || !explanationText) {
    return { narrationText: textWithoutNote, explanationText: null, glossaryNotes };
  }

  return { narrationText, explanationText, glossaryNotes };
}

export function getCommentaryTextParts(
  payload: Pick<CommentaryPayload, "narration" | "explanation" | "glossaryNotes"> & { text?: string }
): CommentaryTextParts {
  const legacyParts = payload.text ? parseLegacyCommentaryText(payload.text) : null;

  return {
    narrationText: normalizeText(payload.narration) ?? legacyParts?.narrationText ?? null,
    explanationText: normalizeText(payload.explanation) ?? legacyParts?.explanationText ?? null,
    glossaryNotes: uniqueNotes(payload.glossaryNotes ?? legacyParts?.glossaryNotes ?? []),
  };
}

export function buildCombinedCommentaryText(parts: CommentaryTextParts): string {
  return [parts.narrationText, parts.explanationText].filter(Boolean).join(" ");
}

const compactRawDetail = (rawDetail?: string): string | null => {
  if (!rawDetail) return null;
  const compact = rawDetail.trim().replace(/\s+/g, " ");
  if (!compact) return null;
  return compact.length > RAW_DETAIL_MAX_LENGTH ? `${compact.slice(0, RAW_DETAIL_MAX_LENGTH)}...` : compact;
};

export function buildSpeechText(
  parts: CommentaryTextParts,
  repeatCount = 1,
  rawDetail?: string,
  mode: CommentaryDisplayMode = "both",
  speech?: CommentarySpeech
): string {
  if (speech) {
    return speech.disposition === "speak" ? speech.text?.trim() ?? "" : "";
  }

  const segments: string[] = [];
  const includeNarration = mode !== "explanation";
  const includeExplanation = mode !== "narration";

  if (includeNarration && parts.narrationText) {
    segments.push(parts.narrationText);
  }

  if (includeExplanation && parts.explanationText && (repeatCount <= 1 || !includeNarration)) {
    segments.push(parts.explanationText);
  }

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
