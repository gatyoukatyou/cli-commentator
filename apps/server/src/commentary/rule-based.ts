import type { CommentaryMode, CommentaryPayload, Event, Style } from "../types.js";
import { isCodexProgressNoise } from "../progress-noise.js";
import { commentStandard } from "../styles/standard.js";
import { commentKansai } from "../styles/kansai.js";
import { commentZundamon } from "../styles/zundamon.js";
import { describeBashMeaning, detailCommand, say } from "./bash-meaning.js";
import { beginnerOneLine } from "./beginner-lines.js";
import { getGlossaryNotes } from "./glossary.js";

const COMMENTERS: Record<Style, (ev: Event) => string> = {
  standard: commentStandard,
  kansai: commentKansai,
  zundamon: commentZundamon,
};

const DETAIL_PREVIEW_MAX = 96;

function detailPreview(detail?: string): string {
  if (!detail) return "";
  const compact = detail.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= DETAIL_PREVIEW_MAX) return compact;
  return `${compact.slice(0, DETAIL_PREVIEW_MAX - 1).trimEnd()}…`;
}

function detailSpotlight(ev: Event, style: Style): string {
  const preview = detailPreview(ev.detail);
  if (!preview) return "";

  if (ev.type === "stdout") {
    if (/^[⏺•]\s*Bash\(/.test(ev.detail ?? "")) {
      return describeBashMeaning(detailCommand(ev.detail), style).spotlight;
    }
    return say(style, {
      standard: `今見えている出力は「${preview}」です。`,
      kansai: `今見えてる出力は「${preview}」や。`,
      zundamon: `今見えてる出力は「${preview}」なのだ。`,
    });
  }

  if (ev.type === "stderr" || ev.type === "error") {
    return say(style, {
      standard: `引っかかっている行は「${preview}」です。`,
      kansai: `引っかかってる行は「${preview}」や。`,
      zundamon: `引っかかってる行は「${preview}」なのだ。`,
    });
  }

  return "";
}


function stripMemoPrefix(text: string): string {
  return text.replace(/^1行メモ:\s*/u, "").trim();
}

function inferCommentaryMode(payload: CommentaryPayload): CommentaryMode {
  if (payload.narration && payload.explanation) return "both";
  if (payload.explanation) return "explanation";
  return "narration";
}

export function isSuppressedCommentaryEvent(ev: Event): boolean {
  return (
    ev.type === "stdout" &&
    ev.summary === "ログ更新" &&
    isCodexProgressNoise((ev.detail ?? "").trim())
  );
}

export function withCommentaryMode(payload: CommentaryPayload): CommentaryPayload {
  return {
    ...payload,
    meta: {
      ...payload.meta,
      mode: payload.meta?.mode ?? inferCommentaryMode(payload),
    },
  };
}

export function commentByRules(ev: Event, style: Style): CommentaryPayload {
  if (isSuppressedCommentaryEvent(ev)) {
    return withCommentaryMode({
      meta: {
        narrationProvider: "rules",
        explanationProvider: "rules",
      },
    });
  }

  const beginner = stripMemoPrefix(beginnerOneLine(ev, style));
  const glossaryNotes = getGlossaryNotes(ev.detail);
  const spotlight = detailSpotlight(ev, style);

  const core = COMMENTERS[style](ev);

  return withCommentaryMode({
    narration: [core, spotlight].filter(Boolean).join(" "),
    explanation: beginner || undefined,
    glossaryNotes,
    meta: {
      narrationProvider: "rules",
      explanationProvider: "rules",
    },
  });
}
