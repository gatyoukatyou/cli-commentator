import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { commentByRules } from "../commentary/rule-based.js";
import { applySpeechContract } from "../commentary/speech-policy.js";
import { extractEvents, resetExtractionState } from "../extract.js";
import { getAutoDetectedSource, resetAutoDetection } from "../rulesets/index.js";
import { createSessionContext } from "../session-context.js";
import { createEscapeCarry, stripTerminalEscapes } from "../terminal-escapes.js";

type CodexTuiFixture = {
  cli: string;
  version: string;
  prompt: string;
  capturedSeconds: number;
  raw: string;
};

type CodexAppChunkFixture = {
  cli: string;
  version: string;
  prompt: string;
  captureSurface: string;
  chunks: string[];
};

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/codex-tui/real-session-0.146.0.json"
);

const appChunkFixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/codex-tui/real-session-0.146.0-app-chunks.json"
);

function loadFixture(): CodexTuiFixture {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as CodexTuiFixture;
}

function loadAppChunkFixture(): CodexAppChunkFixture {
  return JSON.parse(fs.readFileSync(appChunkFixturePath, "utf8")) as CodexAppChunkFixture;
}

function visibleText(raw: string): string {
  const carry = createEscapeCarry();
  let text = "";
  for (let offset = 0; offset < raw.length; offset += 512) {
    text += stripTerminalEscapes(carry(raw.slice(offset, offset + 512)));
  }
  return text;
}

function extractRealEvents(source: "codex" | "auto") {
  const fixture = loadFixture();
  resetAutoDetection();
  resetExtractionState();
  const carry = createEscapeCarry();
  const events = [];

  for (let offset = 0; offset < fixture.raw.length; offset += 512) {
    events.push(
      ...extractEvents(carry(fixture.raw.slice(offset, offset + 512)), source)
    );
  }

  return {
    detected: getAutoDetectedSource(),
    events,
  };
}

function extractAppChunkEvents(source: "codex" | "auto") {
  const fixture = loadAppChunkFixture();
  resetAutoDetection();
  resetExtractionState();
  const carry = createEscapeCarry();
  const events = fixture.chunks.flatMap((chunk) => extractEvents(carry(chunk), source));

  return {
    detected: getAutoDetectedSource(),
    events,
  };
}

describe("real Codex TUI fixture", () => {
  it("contains a real command execution, output, and final response", () => {
    const fixture = loadFixture();

    expect(fixture).toMatchObject({
      cli: "codex",
      version: "0.146.0",
      capturedSeconds: 100,
    });
    expect(fixture.prompt).toContain("find docs -maxdepth 1");
    const visible = visibleText(fixture.raw);
    expect(visible).toContain("• Ran test -f pnpm-workspace.yaml");
    expect(visible).toContain("└ /Users/demo/project");
    expect(visible).toContain("find found 27 files directly under docs/");
  });

  it("does not retain local identity or usage quota details", () => {
    const fixture = loadFixture();

    expect(fixture.raw).not.toContain("/Users/home");
    expect(fixture.raw).not.toContain("AION_Project");
    expect(fixture.raw).not.toContain("gatyoukatyou");
    expect(fixture.raw).not.toMatch(/usage limit resets? available/i);
    expect(fixture.raw).toContain("/Users/demo/project");
  });

  it("extracts only the substantive assistant update, command card, and final answer", () => {
    const explicit = extractRealEvents("codex");
    const automatic = extractRealEvents("auto");
    const explicitEvents = explicit.events.map(({ type, summary, detail }) => ({
      type,
      summary,
      detail,
    }));
    const automaticEvents = automatic.events.map(({ type, summary, detail }) => ({
      type,
      summary,
      detail,
    }));

    expect(explicitEvents).toEqual([
      {
        type: "stdout",
        summary: "Codexが説明している",
        detail: "• リポジトリの安全確認を先に行い、指定された2コマンドを実行します。ファイル変更はしません。",
      },
      {
        type: "search",
        summary: "ファイル一覧を検索している",
        detail: expect.stringContaining("find docs -maxdepth 1 -type f -print"),
      },
      {
        type: "stdout",
        summary: "Codexが回答した",
        detail: expect.stringContaining("Both commands succeeded"),
      },
    ]);
    expect(automatic.detected).toBe("codex");
    expect(automaticEvents).toEqual(explicitEvents);
    expect(explicit.events.at(-1)?.priority).toBe("notice");
  });

  it("narrates the substantive Codex events without generic fallbacks", () => {
    const events = extractRealEvents("codex").events;
    const context = createSessionContext();
    const spoken = events.map((event) => {
      const snapshot = context.observeEvent(event);
      const payload = commentByRules(event, "standard", snapshot);
      return applySpeechContract(payload, event, snapshot).speech?.text;
    });

    expect(spoken).toEqual([
      "Codexが作業内容を説明しています。",
      "ファイル一覧を調べています。",
      "Codexが回答しました。",
    ]);
  });
});

describe("real Codex desktop-sidecar chunk fixture", () => {
  it("preserves the real node-pty chunk boundaries without local identity or quota data", () => {
    const fixture = loadAppChunkFixture();
    const raw = fixture.chunks.join("");
    const visible = visibleText(raw);

    expect(fixture).toMatchObject({
      cli: "codex",
      version: "0.146.0",
      captureSurface: "desktop-sidecar",
    });
    expect(fixture.chunks.length).toBeGreaterThan(700);
    expect(visible).toContain("• Ran test -f pnpm-workspace.yaml");
    expect(visible).toContain("docs/roadmap-issues.en.md");
    expect(raw).not.toContain("/Users/home");
    expect(raw).not.toContain("AION_Project");
    expect(raw).not.toContain("gatyoukatyou");
    expect(raw).not.toMatch(/usage limit resets? available/iu);
  });

  it("extracts the same meaningful events in explicit and auto modes", () => {
    const explicit = extractAppChunkEvents("codex");
    const automatic = extractAppChunkEvents("auto");
    const select = ({ type, summary, detail, priority }: (typeof explicit.events)[number]) => ({
      type,
      summary,
      detail,
      priority,
    });

    expect(automatic.detected).toBe("codex");
    expect(automatic.events.map(select)).toEqual(explicit.events.map(select));
    expect(explicit.events.map(({ type, summary }) => ({ type, summary }))).toEqual([
      { type: "stdout", summary: "Codexが説明している" },
      { type: "search", summary: "該当箇所を検索している" },
      { type: "stdout", summary: "コマンドを実行している" },
      { type: "stdout", summary: "Codexが回答した" },
    ]);
    expect(explicit.events.at(-1)).toMatchObject({
      priority: "notice",
      detail: expect.stringContaining("docs/manual-test-checklist.en.md"),
    });
  });
});
