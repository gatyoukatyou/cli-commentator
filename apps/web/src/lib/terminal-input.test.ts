import { describe, expect, it } from "vitest";
import {
  DUPLICATE_TERMINAL_INPUT_WINDOW_MS,
  shouldSuppressDuplicateTerminalInput,
  type RecentTerminalInput,
} from "./terminal-input";

describe("shouldSuppressDuplicateTerminalInput", () => {
  it("suppresses identical chunks within the duplicate window", () => {
    const previous: RecentTerminalInput = {
      data: "a",
      at: 100,
    };

    expect(
      shouldSuppressDuplicateTerminalInput(
        previous,
        "a",
        100 + DUPLICATE_TERMINAL_INPUT_WINDOW_MS - 1
      )
    ).toBe(true);
  });

  it("allows identical chunks after the duplicate window", () => {
    const previous: RecentTerminalInput = {
      data: "a",
      at: 100,
    };

    expect(
      shouldSuppressDuplicateTerminalInput(
        previous,
        "a",
        100 + DUPLICATE_TERMINAL_INPUT_WINDOW_MS + 1
      )
    ).toBe(false);
  });

  it("allows different chunks immediately", () => {
    const previous: RecentTerminalInput = {
      data: "a",
      at: 100,
    };

    expect(shouldSuppressDuplicateTerminalInput(previous, "b", 101)).toBe(false);
  });
});
