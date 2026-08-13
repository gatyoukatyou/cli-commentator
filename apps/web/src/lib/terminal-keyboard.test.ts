import { describe, expect, it, vi } from "vitest";
import {
  handleTerminalLatestKey,
  jumpTerminalToLatest,
  type TerminalKeyEvent,
} from "./terminal-keyboard";

function createKeyEvent(overrides: Partial<TerminalKeyEvent> = {}): TerminalKeyEvent {
  return {
    altKey: false,
    ctrlKey: false,
    key: "Tab",
    metaKey: false,
    preventDefault: vi.fn(),
    shiftKey: false,
    ...overrides,
  };
}

describe("Managed Terminal latest-position keyboard handling", () => {
  it("moves focus to the visible latest button for plain Tab", () => {
    const focus = vi.fn();
    const event = createKeyEvent();

    expect(
      handleTerminalLatestKey(event, {
        getLatestButton: () => ({ focus }),
        isAtLatest: () => false,
      })
    ).toBe(false);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("passes Tab through when the latest button is not shown", () => {
    const event = createKeyEvent();

    expect(
      handleTerminalLatestKey(event, {
        getLatestButton: () => null,
        isAtLatest: () => true,
      })
    ).toBe(true);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    ["Shift+Tab", { shiftKey: true }],
    ["Ctrl+Tab", { ctrlKey: true }],
    ["Alt+Tab", { altKey: true }],
    ["Meta+Tab", { metaKey: true }],
    ["non-Tab", { key: "Enter" }],
  ] as const)("does not intercept %s", (_name, overrides) => {
    const event = createKeyEvent(overrides);
    const focus = vi.fn();

    expect(
      handleTerminalLatestKey(event, {
        getLatestButton: () => ({ focus }),
        isAtLatest: () => false,
      })
    ).toBe(true);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it("reads the current latest state when Tab is pressed", () => {
    let atLatest = true;
    const focus = vi.fn();
    const context = {
      getLatestButton: () => ({ focus }),
      isAtLatest: () => atLatest,
    };

    expect(handleTerminalLatestKey(createKeyEvent(), context)).toBe(true);

    atLatest = false;
    expect(handleTerminalLatestKey(createKeyEvent(), context)).toBe(false);
    expect(focus).toHaveBeenCalledOnce();
  });

  it("uses one jump action for native button activation and restores terminal focus", () => {
    const calls: string[] = [];

    jumpTerminalToLatest(
      {
        focus: () => calls.push("focus"),
        scrollToBottom: () => calls.push("scroll"),
      },
      () => calls.push("latest")
    );

    expect(calls).toEqual(["latest", "scroll", "focus"]);
  });
});
