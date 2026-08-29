import { describe, expect, it, vi } from "vitest";
import {
  TERMINAL_FORCE_STOP_WINDOW_MS,
  TERMINAL_INTERRUPT_LABEL,
  TERMINAL_INTERRUPT_SEQUENCE,
  decideTerminalInterrupt,
  sendTerminalInterrupt,
} from "./terminal-interrupt";

describe("terminal interrupt control", () => {
  it("sends exactly one Ctrl+C sequence", () => {
    const send = vi.fn();

    sendTerminalInterrupt(send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(TERMINAL_INTERRUPT_SEQUENCE);
  });

  it("uses a label that distinguishes interruption from copying", () => {
    expect(TERMINAL_INTERRUPT_LABEL).toContain("実行を中断");
    expect(TERMINAL_INTERRUPT_LABEL).toContain("Ctrl+C");
    expect(TERMINAL_INTERRUPT_LABEL).not.toContain("コピー");
  });
});

describe("decideTerminalInterrupt", () => {
  it("returns interrupt when no interrupt was sent before", () => {
    expect(decideTerminalInterrupt({ now: 1000, lastInterruptAt: null })).toBe("interrupt");
  });

  it("returns interrupt when the previous interrupt is outside the window", () => {
    expect(
      decideTerminalInterrupt({ now: 1000, lastInterruptAt: 1000 - TERMINAL_FORCE_STOP_WINDOW_MS })
    ).toBe("interrupt");
  });

  it("returns force-stop within the window after the previous interrupt", () => {
    expect(
      decideTerminalInterrupt({ now: 1000, lastInterruptAt: 1000 - (TERMINAL_FORCE_STOP_WINDOW_MS - 1) })
    ).toBe("force-stop");
  });

  it("honors a custom window", () => {
    expect(decideTerminalInterrupt({ now: 1000, lastInterruptAt: 600, windowMs: 500 })).toBe("force-stop");
    expect(decideTerminalInterrupt({ now: 1000, lastInterruptAt: 500, windowMs: 500 })).toBe("interrupt");
  });
});
