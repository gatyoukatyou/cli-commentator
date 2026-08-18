import { describe, expect, it, vi } from "vitest";
import {
  TERMINAL_INTERRUPT_LABEL,
  TERMINAL_INTERRUPT_SEQUENCE,
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
