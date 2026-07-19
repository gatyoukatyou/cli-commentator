import type {
  CommentaryMeta,
  Event,
  EventPriority,
  EventType,
  Profile,
  ProfileSummary,
  ProviderName,
  SourceMode,
  SourceState,
  Style,
  WsOutgoing,
} from "./protocol.js";

const EVENT_TYPES = new Set<EventType>([
  "start",
  "stdout",
  "stderr",
  "read",
  "write",
  "search",
  "test",
  "git",
  "github",
  "install",
  "build",
  "lint",
  "server",
  "error",
  "done",
]);

const EVENT_PRIORITIES = new Set<EventPriority>(["urgent", "notice", "progress"]);

const PROVIDERS = new Set<ProviderName>([
  "disabled",
  "mock",
  "openai",
  "groq",
  "local",
  "anthropic",
  "gemini",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === "string";

const isProviderName = (value: unknown): value is ProviderName =>
  typeof value === "string" && PROVIDERS.has(value as ProviderName);

const isOptionalProviderName = (value: unknown): value is ProviderName | undefined =>
  value === undefined || isProviderName(value);

export const isStyle = (value: unknown): value is Style =>
  value === "standard" || value === "kansai" || value === "zundamon";

export const isSourceMode = (value: unknown): value is SourceMode =>
  value === "auto" || value === "claude" || value === "codex" || value === "generic";

export const isEventType = (value: unknown): value is EventType =>
  typeof value === "string" && EVENT_TYPES.has(value as EventType);

export const isEventPriority = (value: unknown): value is EventPriority =>
  typeof value === "string" && EVENT_PRIORITIES.has(value as EventPriority);

export const isSourceState = (value: unknown): value is SourceState =>
  isRecord(value) &&
  isSourceMode(value.mode) &&
  (value.detected === null ||
    value.detected === "claude" ||
    value.detected === "codex" ||
    value.detected === "generic");

export const isEvent = (value: unknown): value is Event =>
  isRecord(value) &&
  typeof value.ts === "number" &&
  isEventType(value.type) &&
  typeof value.summary === "string" &&
  isOptionalString(value.detail) &&
  (value.priority === undefined || isEventPriority(value.priority));

const isCommentaryMeta = (value: unknown): value is CommentaryMeta =>
  isRecord(value) &&
  isOptionalString(value.narrationProvider) &&
  isOptionalString(value.explanationProvider) &&
  (value.mode === undefined ||
    value.mode === "narration" ||
    value.mode === "explanation" ||
    value.mode === "both");

const COMMENTARY_SPEECH_REASONS = new Set([
  "urgent",
  "human_required",
  "completion",
  "failure",
  "success",
  "new_task",
  "phase_change",
  "new_target",
  "progress_refresh",
  "progress_interval",
  "not_significant",
]);

const isCommentarySpeech = (value: unknown): boolean =>
  isRecord(value) &&
  (value.disposition === "speak" || value.disposition === "display_only") &&
  typeof value.reason === "string" &&
  COMMENTARY_SPEECH_REASONS.has(value.reason) &&
  (value.disposition === "speak"
    ? typeof value.text === "string" && value.text.trim().length > 0
    : value.text === undefined);

const hasCommentaryPayload = (value: Record<string, unknown>): boolean =>
  isOptionalString(value.narration) &&
  isOptionalString(value.explanation) &&
  (value.glossaryNotes === undefined || isStringArray(value.glossaryNotes)) &&
  (value.speech === undefined || isCommentarySpeech(value.speech)) &&
  (value.meta === undefined || isCommentaryMeta(value.meta));

const isProfileSummary = (value: unknown): value is ProfileSummary =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.name === "string" &&
  typeof value.cmd === "string";

const isProfile = (value: unknown): value is Profile =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.name === "string" &&
  typeof value.cmd === "string" &&
  isStringArray(value.args) &&
  isOptionalString(value.cwd) &&
  isStyle(value.style) &&
  isSourceMode(value.logSource) &&
  (value.inputMode === undefined || value.inputMode === "pty" || value.inputMode === "file") &&
  isOptionalString(value.inputFile) &&
  isOptionalProviderName(value.llmProvider) &&
  isOptionalProviderName(value.narrationProvider) &&
  isOptionalProviderName(value.explanationProvider) &&
  typeof value.createdAt === "number" &&
  typeof value.updatedAt === "number";

const normalizeEnvelope = (value: unknown): Record<string, unknown> | null => {
  if (!isRecord(value)) return null;
  if (typeof value.kind === "string") return value;
  if (typeof value.type !== "string") return null;
  if (isRecord(value.payload)) return { ...value.payload, kind: value.type };
  return { ...value, kind: value.type };
};

export function parseServerMessage(value: unknown): WsOutgoing | null {
  const message = normalizeEnvelope(value);
  if (!message) return null;

  switch (message.kind) {
    case "hello":
      return isStyle(message.style) && isSourceState(message.source)
        ? (message as WsOutgoing)
        : null;
    case "style":
      return isStyle(message.style) ? (message as WsOutgoing) : null;
    case "source":
      return isSourceState(message.source) ? (message as WsOutgoing) : null;
    case "raw":
      return typeof message.data === "string" ? (message as WsOutgoing) : null;
    case "event":
      return isEvent(message.ev) ? (message as WsOutgoing) : null;
    case "commentary":
      return typeof message.ts === "number" && isEvent(message.ev) && hasCommentaryPayload(message)
        ? (message as WsOutgoing)
        : null;
    case "profiles":
      return Array.isArray(message.profiles) &&
        message.profiles.every(isProfileSummary) &&
        isNullableString(message.activeId)
        ? (message as WsOutgoing)
        : null;
    case "profileSaved":
      return isProfileSummary(message.profile) && isNullableString(message.activeId)
        ? (message as WsOutgoing)
        : null;
    case "profileDeleted":
      return typeof message.id === "string" && isNullableString(message.activeId)
        ? (message as WsOutgoing)
        : null;
    case "profileDetail":
      return isProfile(message.profile) ? (message as WsOutgoing) : null;
    case "profileError":
    case "ptyError":
      return typeof message.error === "string" ? (message as WsOutgoing) : null;
    case "ptyRestart":
      return typeof message.cmd === "string" &&
        isStringArray(message.args) &&
        isNullableString(message.profileId)
        ? (message as WsOutgoing)
        : null;
    case "ptyUnavailable":
      return typeof message.error === "string" && typeof message.suggestion === "string"
        ? (message as WsOutgoing)
        : null;
    default:
      return null;
  }
}
