import type { Event, EventType } from "../types";
import { buildUrgentSpeechText } from "@cli-commentator/shared/urgent-speech";

/**
 * 即時イベント（kind: "event"）の要対応表示・定型読み上げと、
 * 後続commentaryとの二重通知防止のためのヘルパー。
 */

export type AttentionKind = "input" | "error" | "confirmation";

/** Web UIの要対応バナーに表示する内容 */
export type AttentionNotice = {
  ts: number;
  eventType: EventType;
  summary: string;
  detail?: string;
  kind: AttentionKind;
};

const INPUT_WAIT_SUMMARY_RE = /(?:質問への回答を待っている|入力待ち)/u;
const CONFIRMATION_SUMMARY_RE = /(?:許可を待っている|確認待ち|承認待ち)/u;

/**
 * 既存のイベント種別・summaryだけで、HUMANに必要な操作の違いを決める。
 * 未知のurgentイベントは、入力を誤って促さないよう確認要求として扱う。
 */
export function getAttentionKind(event: Pick<Event, "type" | "summary">): AttentionKind {
  if (event.type === "error") return "error";
  if (INPUT_WAIT_SUMMARY_RE.test(event.summary)) return "input";
  if (CONFIRMATION_SUMMARY_RE.test(event.summary)) return "confirmation";
  return "confirmation";
}

export type AttentionGuidance = {
  label: string;
  message: string;
  focusTerminal: boolean;
  focusLabel: string;
  dismissLabel: string;
};

export function getAttentionGuidance(kind: AttentionKind): AttentionGuidance {
  switch (kind) {
    case "input":
      return {
        label: "入力待ち",
        message:
          "HUMANの回答が必要です。左のManaged Terminalを開いて入力し、Enterキーを押してください。",
        focusTerminal: true,
        focusLabel: "ターミナルへ移動",
        dismissLabel: "確認した",
      };
    case "error":
      return {
        label: "実行エラー",
        message:
          "入力待ちではありません。ターミナルに入力するだけでは解決しないため、エラー内容を確認して失敗した処理や設定を見直してください。",
        focusTerminal: false,
        focusLabel: "",
        dismissLabel: "エラーを確認した",
      };
    case "confirmation":
      return {
        label: "確認要求",
        message:
          "HUMANの確認・承認が必要です。左のManaged Terminalで内容を確認し、必要な許可・承認操作を行ってください。",
        focusTerminal: true,
        focusLabel: "ターミナルへ移動",
        dismissLabel: "確認した",
      };
  }
}

export const MAX_ATTENTION_DETAIL_LENGTH = 1200;

export function limitAttentionDetail(
  value: string | undefined,
  maxLength = MAX_ATTENTION_DETAIL_LENGTH
): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}…（長文のため省略）`;
}

export function toAttentionNotice(ev: Event): AttentionNotice {
  return {
    ts: ev.ts,
    eventType: ev.type,
    summary: ev.summary,
    detail: ev.detail,
    kind: getAttentionKind(ev),
  };
}

/** 同一イベントの即時TTSとcommentary TTSを相関づけるキー */
export function eventSpeechKey(
  event: Pick<Event, "ts" | "type" | "summary" | "detail">
): string {
  const content = `${event.summary}\u0000${event.detail ?? ""}`;
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${event.ts}:${event.type}:${(hash >>> 0).toString(36)}`;
}

/** urgentイベントの定型読み上げ文 */
export function buildUrgentEventSpeechText(
  ev: Pick<Event, "summary" | "detail">
): string {
  return buildUrgentSpeechText(ev);
}

export type SpokenEventRegistry = {
  add(key: string): void;
  has(key: string): boolean;
};

/**
 * 即時イベントで読み上げ済みのキーを記録する（上限つき）。
 * 後続commentaryの読み上げをスキップして二重読み上げを防ぐ。
 */
export function createSpokenEventRegistry(limit = 100): SpokenEventRegistry {
  const keys = new Set<string>();
  const order: string[] = [];

  return {
    add(key) {
      if (keys.has(key)) return;
      keys.add(key);
      order.push(key);
      while (order.length > limit) {
        const oldest = order.shift();
        if (oldest !== undefined) keys.delete(oldest);
      }
    },
    has(key) {
      return keys.has(key);
    },
  };
}
