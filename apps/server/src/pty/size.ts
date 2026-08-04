import type { PtySize } from "@cli-commentator/shared";

export const MIN_PTY_COLS = 2;
export const MAX_PTY_COLS = 500;
export const MIN_PTY_ROWS = 1;
export const MAX_PTY_ROWS = 300;

export function parsePtySize(cols: unknown, rows: unknown): PtySize | null {
  if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows)) return null;

  const normalizedCols = cols as number;
  const normalizedRows = rows as number;
  if (
    normalizedCols < MIN_PTY_COLS ||
    normalizedCols > MAX_PTY_COLS ||
    normalizedRows < MIN_PTY_ROWS ||
    normalizedRows > MAX_PTY_ROWS
  ) {
    return null;
  }

  return { cols: normalizedCols, rows: normalizedRows };
}
