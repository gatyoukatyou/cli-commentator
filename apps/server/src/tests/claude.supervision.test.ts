import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractEvents } from "../extract.js";
import { createEscapeCarry } from "../terminal-escapes.js";
import { commentByRules } from "../commentary/rule-based.js";
import { applySpeechContract } from "../commentary/speech-policy.js";
import { createSessionContext } from "../session-context.js";
import { resetAutoDetection } from "../rulesets/index.js";

const fixtureDir = path.resolve(process.cwd(), "test/fixtures/claude-tui");

function loadChunks(name: string): string {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf8")) as {
    chunks: string[];
  };
  return fixture.chunks.join("");
}

function loadRenderingFixture(): {
  noiseChunks: string[];
  meaningfulChunks: string[];
} {
  return JSON.parse(
    fs.readFileSync(path.join(fixtureDir, "render-noise.json"), "utf8")
  ) as {
    noiseChunks: string[];
    meaningfulChunks: string[];
  };
}

function loadRealSessionEvents(source: "claude" | "auto" = "claude") {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(fixtureDir, "real-session-2.1.220.json"), "utf8")
  ) as { raw: string };
  const carry = createEscapeCarry();
  const events = [];
  if (source === "auto") resetAutoDetection();

  for (let index = 0; index < fixture.raw.length; index += 512) {
    events.push(...extractEvents(carry(fixture.raw.slice(index, index + 512)), source));
  }

  return events;
}

describe("Claude TUI supervision detection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["trust-prompt.json", "tool-approval.json"])("detects permission wait from %s", (name) => {
    expect(extractEvents(loadChunks(name), "claude")).toEqual([
      expect.objectContaining({ type: "stdout", summary: "許可を待っている" }),
    ]);
  });

  it("detects a multiple-choice question", () => {
    expect(extractEvents(loadChunks("question.json"), "claude")).toEqual([
      expect.objectContaining({ type: "stdout", summary: "質問への回答を待っている" }),
    ]);
  });

  it("detects error and completion from the same redraw", () => {
    expect(extractEvents(loadChunks("error-completion.json"), "claude")).toEqual([
      expect.objectContaining({ type: "error", summary: "エラーが発生している" }),
      expect.objectContaining({ type: "done", summary: "作業が完了した" }),
    ]);
  });

  it("distinguishes historical failure prose from a current error", () => {
    expect(extractEvents("The previous attempt failed, so I changed the approach.", "claude")).toEqual([]);
  });

  it.each([
    "Error: the current command failed.",
    "TypeError: Cannot read properties of undefined",
    "ReferenceError: value is not defined",
    "SyntaxError: Unexpected token",
  ])("detects a structured current error: %s", (line) => {
    expect(extractEvents(line, "claude")).toEqual([
      expect.objectContaining({ type: "error", summary: "エラーが出ている" }),
    ]);
  });

  it("does not treat a HUMAN input prompt as an error", () => {
    expect(extractEvents(loadChunks("question.json"), "claude")).toEqual([
      expect.objectContaining({ type: "stdout", summary: "質問への回答を待っている" }),
    ]);
  });

  it("does not treat a warning-only line as an error", () => {
    expect(extractEvents("Warning: this option is deprecated.", "claude")).toEqual([]);
  });

  it.each([
    "The documentation explains when approval is required.",
    "The task is complete only after a reviewer approves it.",
    "Choose a color in the settings page.",
    "The previous command exited successfully with code 0.",
  ])("does not promote normal prose: %s", (chunk) => {
    const events = extractEvents(chunk, "claude");
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ summary: expect.stringMatching(/許可を待っている|質問への回答を待っている|エラーが発生している|作業が完了した/) }),
      ])
    );
  });

  it("suppresses terminal rendering noise from a Claude Code source", () => {
    const { noiseChunks } = loadRenderingFixture();

    for (const chunk of noiseChunks) {
      expect(extractEvents(chunk, "claude"), chunk).toEqual([]);
    }
  });

  it("keeps untrusted redraw content out of Claude commentary", () => {
    const { meaningfulChunks } = loadRenderingFixture();

    for (const chunk of meaningfulChunks) {
      expect(extractEvents(chunk, "claude"), chunk).toEqual([]);
    }
  });

  it("does not promote tab-delimited terminal output to commentary", () => {
    expect(extractEvents("apps/server/src/extract.ts\t42", "claude")).toEqual([]);
  });

  it("keeps only trustworthy activity from the real Claude Code redraw", () => {
    const events = loadRealSessionEvents();

    expect(events.map(({ type, summary, detail }) => ({ type, summary, detail }))).toEqual([
      {
        type: "search",
        summary: "ファイル一覧を検索している",
        detail: "⎿  $ ls -1 /Users/demo/project/docs",
      },
      {
        type: "stdout",
        summary: "作業結果を要約している",
        detail: "Listed 3 directories, ran 1 shell command",
      },
      {
        type: "stdout",
        summary: "作業結果を要約している",
        detail: "Listed 3 directories, ran 1 shell command",
      },
      {
        type: "stdout",
        summary: "Claudeが説明している",
        detail: "⏺docs/の中身は以下の通りです。",
      },
    ]);
  });

  it("narrates the real ls command as a file-list search", () => {
    const event = loadRealSessionEvents().find(({ type }) => type === "search");
    expect(event).toBeDefined();

    const context = createSessionContext();
    const snapshot = context.observeEvent(event!);
    const payload = commentByRules(event!, "standard", snapshot);
    const spoken = applySpeechContract(payload, event!, snapshot).speech?.text;

    expect(spoken).toBe("ファイル一覧を調べています。");
  });

  it("applies Claude filtering after auto detection", () => {
    expect(loadRealSessionEvents("auto")).toEqual(loadRealSessionEvents("claude"));
  });
});
