import { describe, expect, it } from "vitest";
import { extractSearchPattern, isSearchExecution, isTestExecution, tokenizeShellCommand } from "./command-analysis.js";
import { getGlossaryNotes } from "./commentary/glossary.js";

describe("shell command analysis", () => {
  it("tokenizes quoted shell operators without evaluating the command", () => {
    expect(tokenizeShellCommand('rg -n "alpha|beta" src && git status')).toEqual([
      "rg", "-n", "alpha|beta", "src", "&&", "git", "status",
    ]);
    expect(tokenizeShellCommand("rg 'unterminated")).toBeNull();
  });

  it.each([
    ['rg -n "needle" src', "needle"],
    ['rg -n -g "*.ts" "needle" apps/server/src', "needle"],
    ['rg --glob="*.ts" -- "-literal" apps/server/src', "-literal"],
    ["grep -R -n 'legacy value' src", "legacy value"],
    ["grep --include='*.ts' -e 'named export' src", "named export"],
    ["git status && rg -n 'representative search' src", "representative search"],
  ])("extracts the structural rg/grep pattern from %s", (command, expected) => {
    expect(extractSearchPattern(command)).toBe(expected);
  });

  it.each([
    "rg --mystery value src",
    "grep -f patterns.txt src",
    "rg -g '*.ts'",
    "rg 'unterminated",
    "echo rg needle",
  ])("omits uncertain search patterns from %s", (command) => {
    expect(extractSearchPattern(command)).toBeNull();
  });

  it.each([
    ["nl -ba src/commentary.test.ts", false],
    ["rg __tests__ src", false],
    ["test -f package.json", false],
    ["pnpm -C apps/server test", true],
    ["pnpm --filter server test", true],
    ["pnpm exec vitest run", true],
    ["npm run test:unit", true],
    ["npm --prefix apps/server test", true],
    ["npm --workspace web test", true],
    ["npm -w web run test:unit", true],
    ["yarn jest", true],
    ["yarn --cwd apps/server test", true],
    ["yarn workspace server test", true],
    ["yarn workspace server run test:unit", true],
    ["npm --prefix test-fixtures run build", false],
    ["yarn workspace test-utils build", false],
    ["playwright test", true],
  ])("detects only executable test commands: %s", (command, expected) => {
    expect(isTestExecution(`⏺ Bash(${command})`)).toBe(expected);
  });

  it("distinguishes a search command from a test runner's grep option", () => {
    expect(isSearchExecution("rg -n TODO src")).toBe(true);
    expect(isSearchExecution("playwright test --grep smoke")).toBe(false);
  });
});

describe("representative glossary notes", () => {
  it("ignores tool names that appear only in paths or unrelated arguments", () => {
    expect(getGlossaryNotes("⏺ Bash(cat /tmp/git/pnpm-notes.txt)", "stdout")).toEqual([]);
    expect(getGlossaryNotes('⏺ Grep(grep -n "git" apps/pnpm/src)', "search")).toEqual([]);
  });

  it.each([
    ["⏺ Bash(git status -sb)", "git", "補足: git は変更履歴を管理する仕組み"],
    ["pnpm add -D vitest", "install", "補足: pnpm/npm/yarn は依存関係やスクリプト実行に使う"],
    ["rg -n TODO src", "search", "補足: rg はプロジェクト全体を高速検索するコマンド"],
    ["pnpm exec vitest run", "test", "補足: Vitest/Jest は自動テストを走らせる仕組み"],
    ["Update src/index.ts for node-pty websocket reconnect", "write", "補足: pty は CLI を仮想端末として包んで動かす仕組み"],
  ] as const)("keeps one note for the representative operation in %s", (detail, type, expected) => {
    expect(getGlossaryNotes(detail, type)).toEqual([expected]);
  });

  it("emits at most one glossary note", () => {
    expect(getGlossaryNotes("gh pr checks 328 && git status", "github")).toEqual([
      "補足: gh は GitHub を操作する公式CLI",
    ]);
  });
});
