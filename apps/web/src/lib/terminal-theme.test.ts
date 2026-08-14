import { describe, expect, it } from "vitest";
import {
  CLI_TERMINAL_THEME,
  getTerminalTheme,
  STANDARD_TERMINAL_THEME,
} from "./terminal-theme";

describe("Managed Terminal skin themes", () => {
  it("keeps Standard readable and aligned with the Managed Terminal surface", () => {
    expect(getTerminalTheme("standard")).toEqual(STANDARD_TERMINAL_THEME);
    expect(STANDARD_TERMINAL_THEME).toEqual({
      background: "#0f1720",
      foreground: "#f8fafc",
      cursor: "#38bdf8",
      selectionBackground: "rgba(56, 189, 248, 0.24)",
    });
  });

  it("preserves the existing CLI skin theme", () => {
    expect(getTerminalTheme("cli")).toEqual({
      background: "#081019",
      foreground: "#d8f3dc",
      cursor: "#38bdf8",
      selectionBackground: "rgba(56, 189, 248, 0.24)",
    });
    expect(getTerminalTheme("cli")).toEqual(CLI_TERMINAL_THEME);
  });
});
