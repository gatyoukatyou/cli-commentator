import { describe, expect, it } from "vitest";
import { isClaudeTuiNoise } from "../progress-noise.js";
import { createEscapeCarry, stripTerminalEscapes } from "../terminal-escapes.js";

const ESC = "\u001B";
const BEL = "\u0007";

describe("terminal escape stripping", () => {
  // `[@-Z\\-_]` was a range covering `]`, so `ESC ]` matched as a two-character
  // escape and the OSC body survived as text.
  it("removes an OSC terminal-title sequence, body included", () => {
    expect(stripTerminalEscapes(`${ESC}]0;✳ Claude Code${BEL}rest`)).toBe("rest");
    expect(stripTerminalEscapes(`${ESC}]0;⠂ List files in docs folder${BEL}`)).toBe("");
  });

  it("removes an OSC sequence terminated by ST", () => {
    expect(stripTerminalEscapes(`${ESC}]0;title${ESC}\\tail`)).toBe("tail");
  });

  // Claude Code emits these on every repaint; the old class stopped at `Z`.
  it("removes the cursor save/restore pair", () => {
    expect(stripTerminalEscapes(`${ESC}7${ESC}8text`)).toBe("text");
  });

  it("still removes CSI and charset sequences", () => {
    expect(stripTerminalEscapes(`${ESC}[38;5;174mhello${ESC}[0m`)).toBe("hello");
    expect(stripTerminalEscapes(`${ESC}(Bplain`)).toBe("plain");
  });

  it("leaves ordinary text alone", () => {
    expect(stripTerminalEscapes("docs/ の中身は以下の通りです。")).toBe("docs/ の中身は以下の通りです。");
  });
});

describe("escape sequences split across PTY chunks", () => {
  it("carries an unfinished CSI into the next chunk", () => {
    const carry = createEscapeCarry();
    expect(carry(`before${ESC}[38;`)).toBe("before");
    expect(stripTerminalEscapes(carry("5;174mafter"))).toBe("after");
  });

  it("carries an unfinished OSC into the next chunk", () => {
    const carry = createEscapeCarry();
    expect(carry(`${ESC}]0;⠂ List files`)).toBe("");
    expect(stripTerminalEscapes(carry(`in docs folder${BEL}done`))).toBe("done");
  });

  it("carries a lone trailing ESC", () => {
    const carry = createEscapeCarry();
    expect(carry(`text${ESC}`)).toBe("text");
    expect(stripTerminalEscapes(carry("[0mmore"))).toBe("more");
  });

  it("passes complete chunks through untouched", () => {
    const carry = createEscapeCarry();
    expect(carry("plain text")).toBe("plain text");
  });

  // A stray ESC must not stall the stream indefinitely.
  it("gives up once the carried tail grows past the cap", () => {
    const carry = createEscapeCarry();
    const long = `${ESC}[${"1;".repeat(200)}`;
    expect(carry(long)).toBe(long);
  });
});

describe("isClaudeTuiNoise", () => {
  // Captured from a real Claude Code session, after escape stripping.
  it.each([
    "✶82 ✻5✽37Lollygagging…8912Lol",
    "✢4⏺6·Lollygagging…6Lollygagging…gg✢yg",
    "ap✢Ca✳t✶✻a✽C✻",
    "✻(2s · ↓4 tokens)",
    "Lollygagging… (13s · ↓618 tokens)",
    "✻Crunched for 13s",
    "❯ ? for shortcuts",
    "esc to interrupt",
  ])("drops repaint chrome: %s", (line) => {
    expect(isClaudeTuiNoise(line)).toBe(true);
  });

  it.each([
    "docs/の中身は以下の通りです。",
    "⏺ Read(apps/web/src/App.tsx)",
    "$ ls -1 /Users/home/AION_Project/repos/cli-commentator/docs",
    "Listed 3 directories, ran 1 shell command",
    "Error: Cannot find module 'zod'",
  ])("keeps what actually reports progress: %s", (line) => {
    expect(isClaudeTuiNoise(line)).toBe(false);
  });
});
