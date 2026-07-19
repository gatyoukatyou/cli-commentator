import { SESSION_PHASE_LABELS, type SessionContextSnapshot } from "../session-context.js";
import type { CommentaryPayload, Event } from "../types.js";

const RAW_COMMAND_RE =
  /(?:^[⏺•]\s*|\b(?:Bash|Read|Grep|Glob|Update|Write)\(|\bapply_patch\b|\b(?:rg|grep|nl|sed|git|gh|pnpm|npm|yarn)\s+-|\|)/iu;
const MAX_SPEECH_LENGTH = 100;

function firstSentence(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.match(/^.+?[。！？!?](?:[」』”"])?/u)?.[0]?.trim() ?? compact;
}

function safeFallback(event: Event, context: SessionContextSnapshot): string {
  if (context.humanRequired) return "HUMANの対応を待っています。";
  if (event.type === "done") return "作業が完了しました。";
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
  const candidate = firstSentence(payload.narration ?? payload.explanation ?? "");
  if (!candidate || candidate.length > MAX_SPEECH_LENGTH || RAW_COMMAND_RE.test(candidate)) {
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
