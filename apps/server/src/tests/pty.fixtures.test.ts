import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const fixtureDir = path.resolve(process.cwd(), "test/fixtures/claude-tui");

describe("Claude TUI PTY fixtures", () => {
  const fixtureNames = [
    "trust-prompt.json",
    "question.json",
    "tool-approval.json",
    "error-completion.json",
  ];

  it.each(fixtureNames)("keeps %s sanitized and parseable", (fixtureName) => {
    const raw = fs.readFileSync(path.join(fixtureDir, fixtureName), "utf8");
    const fixture = JSON.parse(raw) as { sanitized: boolean; chunks: string[] };

    expect(fixture.sanitized).toBe(true);
    expect(fixture.chunks.length).toBeGreaterThan(0);
    expect(fixture.chunks.join("")).toContain("\u001b[");
    expect(raw).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(raw).not.toContain("/private/tmp/");
  });
});
