import { describe, expect, it } from "vitest";
import { terminalBufferToText, type TerminalBufferLike } from "./terminal-text";

function createBuffer(lines: string[]): TerminalBufferLike {
  return {
    length: lines.length,
    getLine: (index) => {
      const value = lines[index];
      return value === undefined ? undefined : { translateToString: () => value };
    },
  };
}

describe("terminalBufferToText", () => {
  it("returns rendered terminal lines without trailing blank rows", () => {
    expect(terminalBufferToText(createBuffer(["Hermes Agent", "ready", "", ""]))).toBe("Hermes Agent\nready");
  });

  it("handles an unavailable buffer", () => {
    expect(terminalBufferToText(undefined)).toBe("");
  });
});
