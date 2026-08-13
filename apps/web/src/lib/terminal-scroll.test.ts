import { describe, expect, it } from "vitest";
import { isAtTerminalLatest } from "./terminal-scroll";

describe("managed terminal scroll position", () => {
  it("treats the bottom of the buffer as the latest position", () => {
    expect(isAtTerminalLatest({ viewportY: 42, baseY: 42 })).toBe(true);
  });

  it("shows that the user is reading history above the latest position", () => {
    expect(isAtTerminalLatest({ viewportY: 12, baseY: 42 })).toBe(false);
  });

  it("remains latest when the viewport is already past the reported base", () => {
    expect(isAtTerminalLatest({ viewportY: 50, baseY: 42 })).toBe(true);
  });
});
