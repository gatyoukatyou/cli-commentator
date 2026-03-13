export type RecentTerminalInput = {
  data: string;
  at: number;
};

export const DUPLICATE_TERMINAL_INPUT_WINDOW_MS = 20;

export function shouldSuppressDuplicateTerminalInput(
  previous: RecentTerminalInput | null,
  data: string,
  now: number,
  windowMs = DUPLICATE_TERMINAL_INPUT_WINDOW_MS
): boolean {
  if (!previous) return false;
  if (data !== previous.data) return false;
  return now - previous.at <= windowMs;
}
