import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_DETECT_LINES, detectSourceFromText } from "../rulesets/detect.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, "../../test/fixtures");

const cases = [
  { name: "claude.basic.log", expected: "claude" },
  { name: "claude.readonly.log", expected: "claude" },
  { name: "codex.approval.log", expected: "codex" },
  { name: "codex.lifecycle-error.log", expected: "generic" },
  { name: "generic.shell.log", expected: "generic" },
  { name: "mixed-claude-codex-strong.log", expected: "generic" },
  { name: "ignore-strong-signal-after-50-lines.log", expected: "generic" }
] as const;

describe("ruleset auto detect", () => {
  for (const testCase of cases) {
    it(testCase.name, async () => {
      const filePath = path.join(fixturesDir, testCase.name);
      const content = await fs.readFile(filePath, "utf8");
      expect(detectSourceFromText(content)).toBe(testCase.expected);
    });
  }

  it("exports MAX_DETECT_LINES", () => {
    expect(MAX_DETECT_LINES).toBe(50);
  });
});
