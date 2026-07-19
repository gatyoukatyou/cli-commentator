import type { Event, EventType } from "../types";

/**
 * 即時イベント（kind: "event"）の要対応表示・定型読み上げと、
 * 後続commentaryとの二重通知防止のためのヘルパー。
 */

/** Web UIの要対応バナーに表示する内容 */
export type AttentionNotice = {
  ts: number;
  eventType: EventType;
  summary: string;
  detail?: string;
};

export function toAttentionNotice(ev: Event): AttentionNotice {
  return {
    ts: ev.ts,
    eventType: ev.type,
    summary: ev.summary,
    detail: ev.detail,
  };
}

/** 同一イベントの即時TTSとcommentary TTSを相関づけるキー */
export function eventSpeechKey(ts: number, eventType: EventType): string {
  return `${ts}:${eventType}`;
}

/** urgentイベントの定型読み上げ文 */
export function buildUrgentEventSpeechText(ev: Pick<Event, "summary">): string {
  return `要対応です。${ev.summary}。`;
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
