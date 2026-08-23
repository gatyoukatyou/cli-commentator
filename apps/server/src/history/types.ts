export const HISTORY_SCHEMA_VERSION = 1 as const;
export const HISTORY_CONSENT_VERSION = 1 as const;

export type HistorySessionId = string;
export type HistoryRecordId = string;
export type HistoryEventId = string;
export type HistorySpeechId = string;

export type HistorySessionStatus = "active" | "completed" | "aborted";

export type HistoryRecordKind = "event" | "commentary" | "tts";

export type TtsLifecycle =
  | "queued"
  | "started"
  | "completed"
  | "interrupted"
  | "replaced"
  | "dropped";

export type HistorySession = {
  schemaVersion: typeof HISTORY_SCHEMA_VERSION;
  sessionId: HistorySessionId;
  startedAt: number;
  endedAt: number | null;
  status: HistorySessionStatus;

  // Keep only a display-safe name. Raw commands and paths are not stored.
  cliName: string | null;
  provider: string;
  model: string | null;
  generationMode: string;

  recordCount: number;
  byteCount: number;
  storageFile: string;
};

export type HistoryEventRecord = {
  schemaVersion: typeof HISTORY_SCHEMA_VERSION;
  kind: "event";
  recordId: HistoryRecordId;
  sessionId: HistorySessionId;
  eventId: HistoryEventId;
  ts: number;
  eventType: string;
  priority: "urgent" | "notice" | "progress" | "normal";
  summary: string;
};

export type HistoryCommentaryRecord = {
  schemaVersion: typeof HISTORY_SCHEMA_VERSION;
  kind: "commentary";
  recordId: HistoryRecordId;
  sessionId: HistorySessionId;
  eventId: HistoryEventId | null;
  ts: number;
  text: string;
  provider: string;
  model: string | null;
  generationMode: string;
};

export type HistoryTtsRecord = {
  schemaVersion: typeof HISTORY_SCHEMA_VERSION;
  kind: "tts";
  recordId: HistoryRecordId;
  sessionId: HistorySessionId;
  speechId: HistorySpeechId;
  eventId: HistoryEventId | null;
  ts: number;
  lifecycle: TtsLifecycle;
  durationMs: number | null;
  queueDepth: number | null;
  reason: string | null;
};

export type HistoryRecord =
  | HistoryEventRecord
  | HistoryCommentaryRecord
  | HistoryTtsRecord;

export type HistoryManifest = {
  schemaVersion: typeof HISTORY_SCHEMA_VERSION;
  updatedAt: number;
  sessions: HistorySession[];
};

export type HistorySettings = {
  enabled: boolean;
  consentVersion: number | null;
  requiredConsentVersion: typeof HISTORY_CONSENT_VERSION;

  retentionDays: number;
  maxBytes: number;
  maxSessionBytes: number;

  updatedAt: number;
};

export type HistorySessionMetadata = {
  cliName?: string | null;
  provider: string;
  model?: string | null;
  generationMode: string;
  startedAt?: number;
};

export type HistorySettingsPatch = Partial<
  Pick<
    HistorySettings,
    "enabled" | "retentionDays" | "maxBytes" | "maxSessionBytes"
  >
> & {
  consentVersion?: number | null;
};

export type HistoryStorageStats = {
  available: boolean;
  directory: string | null;
  usedBytes: number;
  sessionCount: number;
};
