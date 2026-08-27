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

  it("keeps all composition data closed until compositionend", () => {
    let now = 1000;
    const gate = createTerminalInputGate(() => now);

    gate.noteCompositionStart();
    expect(gate.shouldForward("に")).toBe(false);
    expect(gate.shouldForward("\t")).toBe(false);

    now += 20;
    gate.noteCompositionEnd();
    expect(gate.shouldForward("日本語入力テスト")).toBe(true);

    now += 100;
    expect(gate.shouldForward("日本語入力テスト")).toBe(false);
  });

  it("does not leave the gate closed after composition is cancelled", () => {
    const gate = createTerminalInputGate(() => 1000);

    gate.noteCompositionStart();
    expect(gate.shouldForward("a")).toBe(false);

    gate.noteCompositionCancel();
    expect(gate.shouldForward("a")).toBe(true);
  });

  it("lets xterm finalize IME controls and preserves physical controls", () => {
    const gate = createTerminalInputGate(() => 1000);

    expect(
      gate.handleKeyEvent({
        isComposing: true,
        key: "Tab",
        keyCode: 9,
        type: "keydown",
      })
    ).toBe("ime");
    expect(
      gate.handleKeyEvent({
        isComposing: true,
        key: "Enter",
        keyCode: 13,
        type: "keydown",
      })
    ).toBe("ime");
    expect(
      gate.handleKeyEvent({
        isComposing: false,
        key: "a",
        keyCode: 229,
        type: "keydown",
      })
    ).toBe("ime");

    gate.noteCompositionStart();
    expect(
      gate.handleKeyEvent({
        isComposing: false,
        key: "Tab",
        keyCode: 9,
        type: "keydown",
      })
    ).toBe("ime");
    expect(
      gate.handleKeyEvent({
        isComposing: true,
        key: "Tab",
        keyCode: 9,
        type: "keyup",
      })
    ).toBe("ime");
    expect(gate.shouldForward("日本語")).toBe(true);
    expect(gate.shouldForward("\t")).toBe(false);
    gate.noteCompositionEnd();

    expect(
      gate.handleKeyEvent({
        isComposing: false,
        key: "Tab",
        keyCode: 9,
        type: "keyup",
      })
    ).toBe("normal");
    expect(
      gate.handleKeyEvent({
        isComposing: false,
        key: "Enter",
        keyCode: 13,
        type: "keyup",
      })
    ).toBe("normal");
  });

  it("allows composition data if xterm reports the control key first", () => {
    const gate = createTerminalInputGate(() => 1000);

    gate.noteCompositionStart();
    expect(
      gate.handleKeyEvent({ isComposing: true, key: "Enter", keyCode: 13, type: "keydown" })
    ).toBe("ime");
    expect(gate.shouldForward("\r")).toBe(false);
    expect(gate.shouldForward("日本語入力テスト")).toBe(true);
  });

  it("suppresses control beforeinput from an active IME only", () => {
    const gate = createTerminalInputGate();

    gate.noteCompositionStart();
    expect(
      gate.shouldSuppressBeforeInput({ data: "\t", inputType: "insertText", isComposing: false })
    ).toBe(true);
    expect(
      gate.shouldSuppressBeforeInput({ data: "日本語", inputType: "insertCompositionText", isComposing: true })
    ).toBe(false);

    gate.noteCompositionEnd();
    expect(
      gate.shouldSuppressBeforeInput({ data: "\t", inputType: "insertText", isComposing: false })
    ).toBe(false);
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
