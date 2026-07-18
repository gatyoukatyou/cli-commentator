import type { Event, EventPriority } from "./types.js";

const URGENT_SUMMARIES = new Set([
  "許可を待っている",
  "質問への回答を待っている",
  "エラーが発生している",
]);

export function getEventPriority(event: Event): EventPriority {
  if (event.priority) return event.priority;
  if (event.type === "error" || URGENT_SUMMARIES.has(event.summary)) return "urgent";
  if (event.type === "done" || event.summary === "長考・沈黙が続いている") return "notice";
  return "progress";
}

export function withEventPriority(event: Event): Event & { priority: EventPriority } {
  return {
    ...event,
    priority: getEventPriority(event),
  };
}

export interface CommentaryGate {
  shouldEmit(priority: EventPriority): boolean;
}

export function createCommentaryGate(options?: {
  intervalMs?: number;
  now?: () => number;
}): CommentaryGate {
  const intervalMs = options?.intervalMs ?? 2000;
  const now = options?.now ?? Date.now;
  let lastProgressEmit = Number.NEGATIVE_INFINITY;

  return {
    shouldEmit(priority) {
      if (priority !== "progress") return true;

      const current = now();
      if (current - lastProgressEmit < intervalMs) return false;
      lastProgressEmit = current;
      return true;
    },
  };
}
