import { describe, expect, it } from "vitest";
import {
  MAX_PTY_COLS,
  MAX_PTY_ROWS,
  MIN_PTY_COLS,
  MIN_PTY_ROWS,
  parsePtySize,
} from "../pty/size.js";

describe("parsePtySize", () => {
  it("accepts integer terminal dimensions within the supported range", () => {
    expect(parsePtySize(96, 32)).toEqual({ cols: 96, rows: 32 });
    expect(parsePtySize(MIN_PTY_COLS, MIN_PTY_ROWS)).toEqual({
      cols: MIN_PTY_COLS,
      rows: MIN_PTY_ROWS,
    });
    expect(parsePtySize(MAX_PTY_COLS, MAX_PTY_ROWS)).toEqual({
      cols: MAX_PTY_COLS,
      rows: MAX_PTY_ROWS,
    });
  });

  it("rejects non-integer, non-finite, and out-of-range dimensions", () => {
    expect(parsePtySize(95.5, 32)).toBeNull();
    expect(parsePtySize(96, Number.NaN)).toBeNull();
    expect(parsePtySize("96", 32)).toBeNull();
    expect(parsePtySize(MIN_PTY_COLS - 1, 32)).toBeNull();
    expect(parsePtySize(96, MIN_PTY_ROWS - 1)).toBeNull();
    expect(parsePtySize(MAX_PTY_COLS + 1, 32)).toBeNull();
    expect(parsePtySize(96, MAX_PTY_ROWS + 1)).toBeNull();
  });
});
