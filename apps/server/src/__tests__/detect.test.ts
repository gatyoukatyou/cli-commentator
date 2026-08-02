import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_DETECT_LINES, MIN_DELTA, createAutoDetector, detectSourceFromText } from "../rulesets/detect.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, "../../test/fixtures");

const cases = [
  { name: "claude.basic.log", expected: "claude" },
  { name: "claude.readonly.log", expected: "claude" },
  { name: "codex.approval.log", expected: "codex" },
  { name: "codex.toolcall.log", expected: "codex" },
  { name: "codex-current-toolcall.log", expected: "codex" },
  { name: "codex.lifecycle-error.log", expected: "generic" },
  { name: "generic.shell.log", expected: "generic" },
  { name: "lock-does-not-flip-after-initial-detect.log", expected: "claude" },
  { name: "mixed-claude-codex-noise.log", expected: "generic" },
  { name: "mixed-claude-codex-strong.log", expected: "generic" },
  { name: "ignore-strong-signal-after-50-lines.log", expected: "generic" },
  { name: "codex-keyword-exit-noise.log", expected: "generic" },
  { name: "claude-tail-symbol-noise.log", expected: "generic" },
  { name: "codex-docs-prose-noise.log", expected: "generic" },
  { name: "codex-quoted-toolcall-noise.log", expected: "generic" }
] as const;

describe("ruleset auto detect", () => {
  for (const testCase of cases) {
    it(testCase.name, async () => {
      const filePath = path.join(fixturesDir, testCase.name);
      const content = await fs.readFile(filePath, "utf8");
      expect(detectSourceFromText(content)).toBe(testCase.expected);
    });
  }

  it("keeps the initial decision even if opposite signals appear later", async () => {
    const filePath = path.join(fixturesDir, "lock-does-not-flip-after-initial-detect.log");
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const detector = createAutoDetector();

    let firstDecisionLine = -1;
    let firstDecisionValue: string | null = null;

    for (const [index, line] of lines.entries()) {
      const decided = detector.update(line);
      if (decided && firstDecisionValue === null) {
        firstDecisionValue = decided;
        firstDecisionLine = index;
      }
    }

    if (firstDecisionValue === null) {
      throw new Error("Expected an initial decision before reaching the end of the fixture.");
    }

    expect(firstDecisionLine).toBeLessThan(lines.length - 1);
    expect(firstDecisionValue).toBe("claude");
    expect(detector.get()).toBe("claude");
  });

  it("exports detect constants", () => {
    expect(MAX_DETECT_LINES).toBe(50);
    expect(MIN_DELTA).toBe(4);
  });

  it("detects the sanitized real Claude Code TUI capture", async () => {
    const filePath = path.join(fixturesDir, "claude-tui/real-session-2.1.220.json");
    const fixture = JSON.parse(await fs.readFile(filePath, "utf8")) as { raw: string };

    expect(detectSourceFromText(fixture.raw)).toBe("claude");
  });
});
