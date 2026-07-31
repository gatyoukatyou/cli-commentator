import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractEvents } from "../extract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, "../../test/fixtures");

const cases = [
  { name: "claude.basic.log", source: "claude" },
  { name: "claude.readonly.log", source: "claude" },
  { name: "codex.approval.log", source: "codex" },
  { name: "codex.toolcall.log", source: "codex" },
  { name: "codex.lifecycle-error.log", source: "codex" },
  { name: "generic.shell.log", source: "generic" }
];

describe("extractEvents fixtures", () => {
  const originalEnv = process.env.LOG_SOURCE;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalEnv === undefined) delete process.env.LOG_SOURCE;
    else process.env.LOG_SOURCE = originalEnv;
  });

  for (const testCase of cases) {
    it(testCase.name, async () => {
      process.env.LOG_SOURCE = testCase.source;
      const filePath = path.join(fixturesDir, testCase.name);
      const content = await fs.readFile(filePath, "utf8");
      const events = extractEvents(content);
      expect(events).toMatchSnapshot();
    });
  }

  it("strips ANSI escape sequences before matching Claude rules", () => {
    process.env.LOG_SOURCE = "claude";
    const chunk = "\u001b[32m⏺ Read(/Users/demo/project/README.md)\u001b[39m";
    const events = extractEvents(chunk);
    expect(events).toEqual([
      {
        ts: new Date("2025-01-01T00:00:00.000Z").getTime(),
        type: "read",
        summary: "ファイルを読み込んでいる",
        detail: "⏺ Read(/Users/demo/project/README.md)",
      },
    ]);
  });

  it("does not mistake TypeScript Readonly types for a read-only CLI", () => {
    process.env.LOG_SOURCE = "claude";

    expect(
      extractEvents(
        "const replacements: ReadonlyArray<readonly [RegExp, string]> = [];"
      )
    ).toEqual([
      {
        ts: new Date("2025-01-01T00:00:00.000Z").getTime(),
        type: "stdout",
        summary: "ログ更新",
        detail: "const replacements: ReadonlyArray<readonly [RegExp, string]> = [];",
      },
    ]);
  });

  it("drops Codex progress-noise lines from extraction", () => {
    process.env.LOG_SOURCE = "codex";
    const chunk = ["Working (14s • esc to interrupt)", "w", "•2", "10s • esc to interrupt)"].join("\n");
    const events = extractEvents(chunk);
    expect(events).toEqual([]);
  });

  it("uses the runtime source override for Codex noise suppression", () => {
    delete process.env.LOG_SOURCE;
    const events = extractEvents("10;?\n•2", "codex");
    expect(events).toEqual([]);
  });

  it("keeps short numeric output from an explicit generic log source", () => {
    expect(extractEvents("35", "generic")).toEqual([
      {
        ts: new Date("2025-01-01T00:00:00.000Z").getTime(),
        type: "stdout",
        summary: "ログ更新",
        detail: "35",
      },
    ]);
  });

  it("extracts a Codex question as waiting for a HUMAN response", () => {
    expect(extractEvents("Question 1/1 (1 unanswered)", "codex")).toEqual([
      {
        ts: new Date("2025-01-01T00:00:00.000Z").getTime(),
        type: "stdout",
        summary: "質問への回答を待っている",
        detail: "Question 1/1 (1 unanswered)",
      },
    ]);
  });

  it("does not emit a waiting event for a completed Codex question counter", () => {
    expect(extractEvents("Question 1/1 (0 unanswered)", "codex")).toEqual([]);
  });

  it("attaches the displayed command to a Codex approval request without treating it as executed", () => {
    expect(
      extractEvents(
        "Would you like to run the following command?\npnpm test -- --runInBand",
        "codex"
      )
    ).toEqual([
      {
        ts: new Date("2025-01-01T00:00:00.000Z").getTime(),
        type: "stdout",
        summary: "コマンド実行の確認待ち",
        detail: "Would you like to run the following command?\npnpm test -- --runInBand",
      },
    ]);
  });

  it("extracts current Codex exec tool calls without surfacing routine plugin logs", async () => {
    const content = await fs.readFile(path.join(fixturesDir, "codex-current-toolcall.log"), "utf8");
    const events = extractEvents(content, "codex");

    expect(events.map(({ type, summary, detail }) => ({ type, summary, detail }))).toEqual([
      { type: "search", summary: "該当箇所を検索している", detail: "⏺ Grep(rg -n 'TODO' src)" },
      { type: "read", summary: "ファイルを読み込んでいる", detail: "⏺ Read(sed -n '1,80p' src/index.ts)" },
      { type: "git", summary: "Git操作をしている", detail: "⏺ Bash(git status -sb)" },
      { type: "test", summary: "テスト/型チェックを実行している", detail: "⏺ Bash(pnpm -C apps/server test)" },
      {
        type: "search",
        summary: "ファイル一覧を検索している",
        detail: "⏺ Glob(rg --files src ; sed -n '1,40p' src/app.ts)",
      },
      { type: "search", summary: "該当箇所を検索している", detail: "⏺ Grep(grep -R 'legacy' src)" },
      { type: "error", summary: "終了コードで失敗している", detail: "Command failed with exit code 1" },
      {
        type: "error",
        summary: "エラーが出ている",
        detail:
          '2026-07-19T01:00:09.000000Z ERROR codex_core_plugins::remote::remote_installed_plugin_sync: plugin sync failed failed_remote_plugin_ids=["plugin-demo"]',
      },
    ]);
    expect(events.every((event) => !event.detail?.includes("ToolCall: exec"))).toBe(true);
  });

  it("uses a bounded, redacted preview for multiple exec commands", () => {
    const chunk =
      'ToolCall: exec await Promise.all([tools.exec_command({cmd:"curl --token secret-value https://example.invalid"}), tools.exec_command({cmd:"git status"}), tools.exec_command({cmd:"pnpm test"})]);';
    const events = extractEvents(chunk, "codex");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "git", summary: "Git操作をしている" });
    expect(events[0]?.detail).toBe(
      "⏺ Bash(curl --token=[REDACTED] https://example.invalid ; git status ... (+1 commands))"
    );
    expect(events[0]?.detail).not.toContain("secret-value");
    expect(events[0]?.detail).not.toContain("pnpm test");
  });

  it("safely drops current exec calls whose cmd is not a static string", () => {
    const events = extractEvents(
      'ToolCall: exec const buildCommand = getCommand(); const r = await tools.exec_command({cmd:buildCommand}); text(r.output);',
      "codex"
    );

    expect(events).toEqual([]);
  });

  it("suppresses write_stdin in the current exec wrapper", () => {
    const events = extractEvents(
      'ToolCall: exec const r = await tools.write_stdin({session_id:42,chars:"",yield_time_ms:1000}); text(r.output);',
      "codex"
    );

    expect(events).toEqual([]);
  });

  it.each([
    "ToolCall: wait",
    'ToolCall: wait {"cell_id":"cell-demo","yield_time_ms":1000}',
    'ToolCall: tools.wait {"cell_id":"cell-demo"}',
  ])("suppresses Codex wait polling: %s", (line) => {
    expect(extractEvents(line, "codex")).toEqual([]);
  });

  it("keeps ordinary Codex tool calls after suppressing wait", () => {
    expect(extractEvents('ToolCall: read_mcp_resource {"server":"demo","uri":"demo://resource"}', "codex"))
      .toMatchObject([{ type: "read", summary: "ファイルを読み込んでいる" }]);
  });

  it.each([
    "nl -ba apps/server/src/commentary.test.ts",
    "sed -n '1,80p' apps/server/src/commentary.test.ts",
    "cat apps/server/src/__tests__/extract.test.ts",
    "head -n 20 apps/server/src/__tests__/extract.test.ts",
  ])("classifies test-file reads as reads: %s", (cmd) => {
    const events = extractEvents(`ToolCall: exec_command {"cmd":${JSON.stringify(cmd)}}`, "codex");
    expect(events).toMatchObject([{ type: "read", summary: "ファイルを読み込んでいる" }]);
  });

  it.each([
    "rg -n '__tests__' apps/server/src",
    "grep -R '__tests__' apps/server/src",
  ])("does not classify searches for test paths as test runs: %s", (cmd) => {
    const events = extractEvents(`ToolCall: exec_command {"cmd":${JSON.stringify(cmd)}}`, "codex");
    expect(events).toMatchObject([{ type: "search" }]);
  });

  it.each([
    "pnpm -C apps/server test",
    "pnpm -C apps/server exec vitest run",
    "npm --prefix apps/server test",
    "npm --workspace web test",
    "yarn --cwd apps/server test",
    "yarn workspace server test",
    "npx jest --runInBand",
    "playwright test",
    "playwright test --grep smoke",
  ])("keeps actual test executions classified as tests: %s", (cmd) => {
    const events = extractEvents(`ToolCall: exec_command {"cmd":${JSON.stringify(cmd)}}`, "codex");
    expect(events).toMatchObject([{ type: "test", summary: "テスト/型チェックを実行している" }]);
  });

  it("does not confuse the shell test builtin with a test runner", () => {
    const events = extractEvents('ToolCall: exec_command {"cmd":"test -f package.json"}', "codex");
    expect(events).toMatchObject([{ type: "stdout", summary: "コマンドを実行している" }]);
  });

  it("does not treat an empty failed-id field as an error", () => {
    expect(extractEvents("failed_remote_plugin_ids=[]", "codex")).toEqual([]);
  });
});
