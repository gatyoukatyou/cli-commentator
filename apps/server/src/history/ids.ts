import { randomUUID } from "node:crypto";
import type {
  HistoryEventId,
  HistoryRecordId,
  HistorySessionId,
  HistorySpeechId,
} from "./types.js";

/**
 * History identifiers are opaque server-generated strings.
 * Clients must not infer meaning from their representation.
 */
export function createHistorySessionId(): HistorySessionId {
  return randomUUID();
}

export function createHistoryRecordId(): HistoryRecordId {
  return randomUUID();
}

export function createHistoryEventId(): HistoryEventId {
  return randomUUID();
}

export function createHistorySpeechId(): HistorySpeechId {
  return randomUUID();
}
