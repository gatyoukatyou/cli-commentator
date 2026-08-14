export type TerminalTheme = {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
};

export const STANDARD_TERMINAL_THEME: TerminalTheme = {
  // Keep the xterm surface aligned with the existing Managed Terminal panel.
  background: "#0f1720",
  foreground: "#f8fafc",
  cursor: "#38bdf8",
  selectionBackground: "rgba(56, 189, 248, 0.24)",
};

export const CLI_TERMINAL_THEME: TerminalTheme = {
  background: "#081019",
  foreground: "#d8f3dc",
  cursor: "#38bdf8",
  selectionBackground: "rgba(56, 189, 248, 0.24)",
};

export function getTerminalTheme(skin: "standard" | "cli"): TerminalTheme {
  return skin === "cli" ? CLI_TERMINAL_THEME : STANDARD_TERMINAL_THEME;
}
