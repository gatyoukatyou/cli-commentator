import type { Event } from "./protocol.js";

export declare function buildUrgentSpeechText(
  event: Pick<Event, "summary" | "detail">
): string;
