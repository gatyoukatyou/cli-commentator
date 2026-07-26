import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractEvents } from "../extract.js";

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

  it("keeps meaningful Claude Code redraw content", () => {
    const { meaningfulChunks } = loadRenderingFixture();

    for (const chunk of meaningfulChunks) {
      expect(extractEvents(chunk, "claude"), chunk).not.toEqual([]);
    }
  });
});
