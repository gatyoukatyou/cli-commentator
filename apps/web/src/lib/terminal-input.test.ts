import { describe, expect, it } from "vitest";
import { createTerminalInputGate } from "./terminal-input";

describe("createTerminalInputGate", () => {
  it("passes through ordinary single-byte typing", () => {
    let now = 1000;
    const gate = createTerminalInputGate(() => now);

    expect(gate.shouldForward("a")).toBe(true);
    now += 30;
    expect(gate.shouldForward("a")).toBe(true);
  });

  it("suppresses duplicate composed chunks right after composition end", () => {
    let now = 1000;
    const gate = createTerminalInputGate(() => now);

    gate.noteCompositionStart();
    expect(gate.shouldForward("あ")).toBe(false);

    now += 20;
    gate.noteCompositionEnd();
    expect(gate.shouldForward("あ")).toBe(true);

    now += 30;
    expect(gate.shouldForward("あ")).toBe(false);
  });

  it("suppresses duplicate pasted chunks in a short window", () => {
    let now = 1000;
    const gate = createTerminalInputGate(() => now);

    gate.notePaste();
    expect(gate.shouldForward("git status")).toBe(true);

    now += 40;
    expect(gate.shouldForward("git status")).toBe(false);
  });

  it("allows the same multi-byte text again after the safety window", () => {
    let now = 1000;
    const gate = createTerminalInputGate(() => now);

    gate.noteCompositionEnd();
    expect(gate.shouldForward("テスト")).toBe(true);

    now += 250;
    expect(gate.shouldForward("テスト")).toBe(true);
  });
});
