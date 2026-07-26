import { SESSION_PHASE_LABELS, type SessionContextSnapshot } from "../session-context.js";
import { buildUrgentSpeechText } from "@cli-commentator/shared";
import { getEventPriority } from "../event-priority.js";
import type { CommentaryPayload, Event } from "../types.js";

const RAW_COMMAND_RE =
  /(?:^[⏺•]\s*|\b(?:Bash|Read|Grep|Glob|Update|Write)\(|\bapply_patch\b|\b(?:rg|grep|nl|sed|git|gh|pnpm|npm|yarn|cat|find|ls|cd|pwd|node|tsx|cargo|docker|curl)\b(?:\s+|$)|\|)/iu;
const MAX_SPEECH_LENGTH = 100;

export function hasRawCommandText(text?: string): boolean {
  return Boolean(text && RAW_COMMAND_RE.test(text));
}

function firstSentence(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.match(/^.+?[。！？!?](?:[」』”"])?/u)?.[0]?.trim() ?? compact;
}

function safeFallback(event: Event, context: SessionContextSnapshot): string {
  if (context.humanRequired) return "HUMANの対応を待っています。";
  if (context.speech.reason === "failure") return "処理が正常に終了しませんでした。";
  if (event.type === "done") {
    return /\b(?:exit[_ ]?code|code)\s*=\s*0\b/iu.test(`${event.summary} ${event.detail ?? ""}`)
      ? "作業が完了しました。"
      : "処理が終了しました。";
  }
  if (event.type === "error") return "エラーを確認しています。";
  if (context.phaseChanged && context.phase !== "unknown") {
    return `${SESSION_PHASE_LABELS[context.phase]}段階に移りました。`;
  }
  switch (event.type) {
    case "read":
      return "対象ファイルを確認しています。";
    case "search":
      return "関連箇所を調査しています。";
    case "write":
      return "変更を反映しています。";
    case "test":
    case "lint":
    case "build":
      return "検証を進めています。";
    case "git":
    case "github":
      return "変更の共有準備を進めています。";
    default:
      return "作業の状態が変わりました。";
  }
}

function speechSentence(
  payload: CommentaryPayload,
  event: Event,
  context: SessionContextSnapshot
): string {
  if (getEventPriority(event) === "urgent") {
    return buildUrgentSpeechText(event);
  }
  if (event.type === "done") {
    return safeFallback(event, context);
  }
  const candidate = firstSentence(payload.narration ?? payload.explanation ?? "");
  if (!candidate || candidate.length > MAX_SPEECH_LENGTH || hasRawCommandText(candidate)) {
    return safeFallback(event, context);
  }
  return candidate;
}

export function applySpeechContract(
  payload: CommentaryPayload,
  event: Event,
  context?: SessionContextSnapshot
): CommentaryPayload {
  if (!context || context.sequence === 0) return payload;
  if (context.speech.disposition === "display_only") {
    return { ...payload, speech: { ...context.speech } };
  }
  return {
    ...payload,
    speech: {
      ...context.speech,
      text: speechSentence(payload, event, context),
    },
  };
}
