import type { Event } from "../types";

export type SessionStatusSignal =
  | { kind: "event"; ev: Event }
  | { kind: "ptyExit" }
  | { kind: "ptyRestart" };

export function updateSessionEnded(current: boolean, signal: SessionStatusSignal): boolean {
  if (signal.kind === "ptyExit") return true;
  if (signal.kind === "ptyRestart") return false;
  return current;
}

export function formatSessionStatusLabel(label: string, sessionEnded: boolean): string {
  const normalized = label.trim() || "session";
  return sessionEnded ? `${normalized}（終了済み）` : normalized;
}
