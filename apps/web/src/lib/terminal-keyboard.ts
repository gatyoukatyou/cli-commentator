export type TerminalKeyEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "preventDefault" | "shiftKey"
>;

export type TerminalLatestButton = Pick<HTMLButtonElement, "focus">;

export type TerminalLatestKeyContext = {
  getLatestButton: () => TerminalLatestButton | null;
  isAtLatest: () => boolean;
};

export function handleTerminalLatestKey(event: TerminalKeyEvent, context: TerminalLatestKeyContext): boolean {
  const isPlainTab =
    event.key === "Tab" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
  if (!isPlainTab || context.isAtLatest()) return true;

  const latestButton = context.getLatestButton();
  if (!latestButton) return true;

  event.preventDefault();
  latestButton.focus();
  return false;
}

export type TerminalLatestActions = {
  focus: () => void;
  scrollToBottom: () => void;
};

export function jumpTerminalToLatest(terminal: TerminalLatestActions, markAtLatest: () => void): void {
  markAtLatest();
  terminal.scrollToBottom();
  terminal.focus();
}
