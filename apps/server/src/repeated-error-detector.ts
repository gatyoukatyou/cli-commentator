import type { Event } from "./types.js";

const DEFAULT_THRESHOLD = 3;
const DEFAULT_WINDOW_MS = 2 * 60 * 1000;

const normalizeErrorSignature = (event: Event): string =>
  `${event.summary}\n${event.detail ?? ""}`
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");

export interface RepeatedErrorDetector {
  observe(event: Event): Event;
  reset(): void;
}

export function createRepeatedErrorDetector(options?: {
  threshold?: number;
  windowMs?: number;
  now?: () => number;
}): RepeatedErrorDetector {
  const threshold = Math.max(2, options?.threshold ?? DEFAULT_THRESHOLD);
  const windowMs = Math.max(1, options?.windowMs ?? DEFAULT_WINDOW_MS);
  const now = options?.now ?? Date.now;
  let signature: string | null = null;
  let count = 0;
  let lastSeenAt = Number.NEGATIVE_INFINITY;
  let alerted = false;

  const reset = () => {
    signature = null;
    count = 0;
    lastSeenAt = Number.NEGATIVE_INFINITY;
    alerted = false;
  };

  return {
    observe(event) {
      if (event.type === "start" || event.type === "done") {
        reset();
        return event;
      }

      if (event.type !== "error") return event;

      const currentTime = now();
      const nextSignature = normalizeErrorSignature(event);
      if (nextSignature !== signature || currentTime - lastSeenAt > windowMs) {
        signature = nextSignature;
        count = 1;
        alerted = false;
      } else {
        count += 1;
      }
      lastSeenAt = currentTime;

      if (count < threshold || alerted) return event;

      alerted = true;
      return {
        ...event,
        summary: "同じエラーが繰り返されている",
        detail: `${count}回検出: ${event.detail ?? event.summary}`,
        priority: "urgent",
      };
    },
    reset,
  };
}
