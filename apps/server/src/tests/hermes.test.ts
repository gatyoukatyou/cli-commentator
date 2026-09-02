import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractEvents, resetExtractionState } from "../extract.js";
import { getAutoDetectedSource, resetAutoDetection } from "../rulesets/index.js";
import { detectSourceFromCommand, detectSourceFromText } from "../rulesets/detect.js";
import { normalizeSource } from "../shared/validation.js";
import { commentByRules, isSuppressedCommentaryEvent } from "../commentary/rule-based.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, "../../test/fixtures/hermes");

async function fixture(name: string): Promise<string> {
  return fs.readFile(path.join(fixturesDir, name), "utf8");
}

function compactEvents(events: ReturnType<typeof extractEvents>) {
  return events.map(({ type, summary, detail }) => ({ type, summary, detail }));
}

describe("Hermes Agent ruleset", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T00:00:00.000Z"));
    resetExtractionState();
    resetAutoDetection();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the Hermes ruleset for an explicit source override", async () => {
    const events = extractEvents(await fixture("startup.log"), "hermes");

    expect(events).toEqual([
      {
        ts: new Date("2026-08-24T00:00:00.000Z").getTime(),
        type: "start",
        summary: "Hermes Agentセッションを開始した",
        detail: "Hermes Agent session started",
      },
    ]);
    expect(getAutoDetectedSource()).toBeNull();
  });

  it("uses Hermes when LOG_SOURCE is explicitly set", async () => {
    const previous = process.env.LOG_SOURCE;
    process.env.LOG_SOURCE = "hermes";
    try {
      expect(compactEvents(extractEvents("hermes --tui\n"))).toEqual([
        { type: "start", summary: "Hermes Agentセッションを開始した", detail: "Hermes Agent session started" },
      ]);
      expect(getAutoDetectedSource()).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.LOG_SOURCE;
      else process.env.LOG_SOURCE = previous;
    }
  });

  it("keeps a single-query command and prompt out of event details", () => {
    const events = extractEvents('hermes chat -q "show the private deployment prompt"\n', "hermes");

    expect(compactEvents(events)).toEqual([
      { type: "start", summary: "Hermes Agentセッションを開始した", detail: "Hermes Agent session started" },
    ]);
    expect(JSON.stringify(events)).not.toContain("private deployment prompt");
  });

  it("extracts a normal streamed response and completion without exposing text", async () => {
    const events = extractEvents(await fixture("response.log"), "hermes");

    expect(compactEvents(events)).toEqual([
      { type: "start", summary: "Hermes Agentセッションを開始した", detail: "Hermes Agent session started" },
      { type: "stdout", summary: "Hermesの入力を待っている", detail: "Hermes input prompt" },
      { type: "stdout", summary: "Hermesが応答をストリーミングしている", detail: "model response stream" },
      { type: "done", summary: "Hermesの応答が完了した", detail: "Hermes response completed" },
    ]);
    expect(JSON.stringify(events)).not.toContain("requested change");
  });

  it("normalizes terminal, web, and skills tool feeds to safe categories", async () => {
    const terminalEvents = extractEvents(await fixture("terminal-tool.log"), "hermes");
    resetExtractionState();
    const webAndSkillsEvents = extractEvents(await fixture("web-skills-tool.log"), "hermes");
    resetExtractionState();
    const commandEvents = extractEvents(await fixture("command-running.log"), "hermes");

    expect(compactEvents(terminalEvents)).toEqual([
      { type: "start", summary: "Hermes Agentセッションを開始した", detail: "Hermes Agent session started" },
      { type: "stdout", summary: "ターミナルツールを実行している", detail: "terminal tool" },
      { type: "stdout", summary: "ターミナルツールを実行している", detail: "terminal tool" },
    ]);
    expect(compactEvents(webAndSkillsEvents)).toEqual([
      { type: "start", summary: "Hermes Agentセッションを開始した", detail: "Hermes Agent session started" },
      { type: "search", summary: "Webツールを実行している", detail: "web tool" },
      { type: "read", summary: "スキルを読み込んでいる", detail: "skills tool" },
    ]);
    expect(compactEvents(commandEvents)).toEqual([
      { type: "start", summary: "Hermes Agentセッションを開始した", detail: "Hermes Agent session started" },
      { type: "stdout", summary: "Hermesのコマンドを実行している", detail: "command execution" },
    ]);
    expect(JSON.stringify(terminalEvents)).not.toContain("/Users/demo/project");
    expect(JSON.stringify(terminalEvents)).not.toContain(".env");
  });

  it("covers approval wait, slash commands, interruption, completion, and errors", async () => {
    const approval = compactEvents(extractEvents(await fixture("approval.log"), "hermes"));
    resetExtractionState();
    const slash = compactEvents(extractEvents(await fixture("slash-reset.log"), "hermes"));
    resetExtractionState();
    const interrupted = compactEvents(extractEvents(await fixture("interrupt.log"), "hermes"));
    resetExtractionState();
    const done = compactEvents(extractEvents(await fixture("done.log"), "hermes"));
    resetExtractionState();
    const error = compactEvents(extractEvents(await fixture("error.log"), "hermes"));

    expect(approval).toEqual([
      { type: "start", summary: "Hermes Agentセッションを開始した", detail: "Hermes Agent session started" },
      { type: "stdout", summary: "Hermesの承認を待っている", detail: "approval prompt" },
    ]);
    expect(slash).toEqual([
      { type: "start", summary: "Hermes Agentセッションを開始した", detail: "Hermes Agent session started" },
      { type: "stdout", summary: "Hermesのスラッシュコマンドを実行している", detail: "/reset" },
      { type: "stdout", summary: "Hermesのスラッシュコマンドを実行している", detail: "/model" },
    ]);
    expect(interrupted).toEqual([
      { type: "start", summary: "Hermes Agentセッションを開始した", detail: "Hermes Agent session started" },
      { type: "stdout", summary: "Hermesの処理を中断した", detail: "Ctrl+C interruption" },
    ]);
    expect(done).toEqual([
      { type: "start", summary: "Hermes Agentセッションを開始した", detail: "Hermes Agent session started" },
      { type: "done", summary: "Hermesの応答が完了した", detail: "Hermes response completed" },
      { type: "done", summary: "Hermesセッションを終了した", detail: "Hermes session ended" },
    ]);
    expect(error).toEqual([
      { type: "start", summary: "Hermes Agentセッションを開始した", detail: "Hermes Agent session started" },
      { type: "error", summary: "Hermesでエラーが発生している", detail: "Hermes error output" },
    ]);
  });

  it("strips ANSI and joins fragmented TUI output without duplicate streaming events", async () => {
    const data = JSON.parse(await fixture("fragmented-stream.json")) as { chunks: string[] };
    const events = data.chunks.flatMap((chunk) => extractEvents(chunk, "hermes"));

    expect(compactEvents(events)).toEqual([
      { type: "start", summary: "Hermes Agentセッションを開始した", detail: "Hermes Agent session started" },
      { type: "stdout", summary: "Hermesの入力を待っている", detail: "Hermes input prompt" },
      { type: "stdout", summary: "Hermesが応答をストリーミングしている", detail: "model response stream" },
      { type: "done", summary: "Hermesの応答が完了した", detail: "Hermes response completed" },
    ]);
  });

  it("does not over-narrate repeated thinking redraws", () => {
    const events = extractEvents(
      [
        "Hermes Agent v0.1.0",
        "pondering... (1.2s)",
        "pondering... (2.4s)",
        "pondering... (3.6s)",
      ].join("\n"),
      "hermes",
    );

    expect(events.filter((event) => event.summary === "Hermesがモデル応答を生成している")).toHaveLength(1);
  });

  it("ignores the live Hermes spinner and status counter redraws", () => {
    const events = extractEvents(
      [
        "Hermes Agent v0.1.0",
        "(｡•́︿•̀｡) analyzing… · 14m 52s ox alphafree 34",
        "•_•)>⌐- formulating… · 23m45s oxalpha free",
        "⌐ brainstorming… · 23m 47s oxalpha free 44.4",
        "͡° ͜ʖ ͡°) rflecting… · 19m 47s ox alpha free 36",
        "10s ox alpha fre 52",
        "⣤",
        "⣶",
        "⠀",
        "turn complete",
      ].join("\n"),
      "hermes",
    );

    expect(compactEvents(events)).toEqual([
      { type: "start", summary: "Hermes Agentセッションを開始した", detail: "Hermes Agent session started" },
      { type: "stdout", summary: "Hermesがモデル応答を生成している", detail: "model response stream" },
      { type: "done", summary: "Hermesの応答が完了した", detail: "Hermes response completed" },
    ]);
  });

  it("ignores banner metadata and the live status bar", () => {
    const events = extractEvents(
      [
        "Hermes Agent v0.1.0",
        "Terminal backend: direct",
        "Working directory: /Users/demo/project",
        "Available tools: terminal, web, skills",
        "Installed skills: github-auth",
        "⚕ claude-sonnet-4 │ 12.4K/200K │ [██████░░░░] 6% │ $0.06 │ 15m",
      ].join("\n"),
      "hermes",
    );

    expect(compactEvents(events)).toEqual([
      { type: "start", summary: "Hermes Agentセッションを開始した", detail: "Hermes Agent session started" },
    ]);
  });

  it("auto-detects strong Hermes combinations after ANSI normalization", async () => {
    const content = await fixture("startup.log");
    expect(detectSourceFromText(content)).toBe("hermes");
    expect(detectSourceFromText("\u001b[35mHermes Agent\u001b[0m\n┊ 💻 terminal `ls`\n")).toBe("hermes");
  });

  it("seeds Hermes auto mode from the exact launcher executable", () => {
    expect(detectSourceFromCommand("/Users/demo/.local/bin/hermes")).toBe("hermes");
    expect(detectSourceFromCommand("hermes-agent")).toBe("hermes");
    expect(detectSourceFromCommand("python")).toBeNull();
    expect(detectSourceFromCommand("echo hermes")).toBeNull();
  });

  it("selects Hermes rules during auto extraction when identity and tool-feed signals arrive together", () => {
    const events = extractEvents("Hermes Agent v0.1.0\n┊ 💻 terminal `ls`\n", "auto");

    expect(getAutoDetectedSource()).toBe("hermes");
    expect(compactEvents(events)).toEqual([
      { type: "start", summary: "Hermes Agentセッションを開始した", detail: "Hermes Agent session started" },
      { type: "stdout", summary: "ターミナルツールを実行している", detail: "terminal tool" },
    ]);
  });

  it.each([
    "hermes",
    "A normal sentence mentions hermes in lowercase.",
    "The file is named hermes-agent.txt.",
    "╭────────╮\n│ ordinary box │\n╰────────╯",
    "❯ /model",
    "Hermes Agent",
  ])("keeps a weak or generic Hermes-like signal generic: %s", (text) => {
    expect(detectSourceFromText(text)).toBe("generic");
  });

  it("does not replace Claude or Codex detection when Hermes is mentioned in their logs", () => {
    expect(detectSourceFromText("Claude Code v2.1.220\nHermes is mentioned in a note.")).toBe("claude");
    expect(detectSourceFromText("OpenAI Codex (v0.146.0)\nHermes is mentioned in a note.")).toBe("codex");
  });

  it("keeps a generic Hermes-like fixture out of the Hermes ruleset", async () => {
    expect(detectSourceFromText(await fixture("generic-hermes-like.log"))).toBe("generic");
    expect(detectSourceFromText(await fixture("mixed-hermes-word.log"))).toBe("generic");
  });

  it("accepts Hermes as an explicit LOG_SOURCE value", () => {
    expect(normalizeSource("hermes")).toBe("hermes");
    expect(normalizeSource(" HERMES ")).toBe("hermes");
  });

  it("narrates tool activity from the v0.20 TUI fixture without flooding or leaking content", async () => {
    const raw = await fixture("tui-tool-activity.log");
    // PTY delivers small chunks; replay realistically instead of one big blob.
    const chunks: string[] = [];
    for (let offset = 0; offset < raw.length; offset += 512) {
      chunks.push(raw.slice(offset, offset + 512));
    }
    const events = chunks.flatMap((chunk) => extractEvents(chunk, "hermes"));
    const summaries = events.map((event) => event.summary);

    const countBy = (summary: string) => summaries.filter((s) => s === summary).length;
    // Meaningful stages are picked up.
    expect(countBy("Hermes Agentセッションを開始した")).toBe(1);
    expect(countBy("Hermesが検索を実行している")).toBeGreaterThanOrEqual(1);
    expect(countBy("Hermesがファイルを読んでいる")).toBeGreaterThanOrEqual(1);
    expect(countBy("Hermesがターミナルコマンドを実行している")).toBeGreaterThanOrEqual(1);
    expect(countBy("Hermesが別の作業へ移った")).toBeGreaterThanOrEqual(1);
    // 過密実況にならない（連続同カテゴリは1回だけ）。
    expect(countBy("Hermesが検索を実行している")).toBeLessThanOrEqual(2);
    expect(countBy("Hermesがファイルを読んでいる")).toBeLessThanOrEqual(2);
    // 30分ツール連続でも実況が溢れない規模に抑える。
    expect(events.length).toBeLessThanOrEqual(20);
    // 「outputなし」ではなく実際の活動を捉えている。
    expect(summaries).not.toContain("ログ更新");
    // ANSI断片・原文・題目・ステータスバーの内容を実況しない。
    const serialized = JSON.stringify(events);
    expect(serialized).not.toMatch(/\u001b/);
    expect(serialized).not.toContain("MARKER");
    expect(serialized).not.toContain("notes.txt");
    expect(serialized).not.toContain("grep");
    expect(serialized).not.toContain("wc -l");
    expect(serialized).not.toContain("preparing");
    expect(serialized).not.toContain("deadbeef");
    expect(serialized).not.toContain("test-model");
    expect(serialized).not.toContain("Summarize the sample folder");
  });

  it("provides a visible explanation for Hermes progress and suppresses low-value generic redraws", () => {
    const hermesProgress = {
      ts: 1,
      type: "stdout" as const,
      summary: "Hermesが応答をストリーミングしている",
      detail: "model response stream",
    };
    const genericRedraw = {
      ts: 2,
      type: "stdout" as const,
      summary: "ログ更新",
      detail: "7",
    };
    const genericText = {
      ts: 3,
      type: "stdout" as const,
      summary: "ログ更新",
      detail: "Tests 3 passed",
    };
    const genericHermesStatus = {
      ts: 4,
      type: "stdout" as const,
      summary: "ログ更新",
      detail: "10s ox alpha fre 52",
    };

    expect(commentByRules(hermesProgress, "kansai").explanation).toContain("応答を少しずつ");
    expect(isSuppressedCommentaryEvent(genericRedraw)).toBe(true);
    expect(isSuppressedCommentaryEvent(genericHermesStatus)).toBe(true);
    expect(isSuppressedCommentaryEvent(genericText)).toBe(false);
    expect(commentByRules(genericText, "kansai").explanation).toContain("テスト結果");
  });
});
