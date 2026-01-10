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
});
