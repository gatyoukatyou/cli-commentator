import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEscapeCarry, stripTerminalEscapes } from "../terminal-escapes.js";

type CodexTuiFixture = {
  cli: string;
  version: string;
  prompt: string;
  capturedSeconds: number;
  raw: string;
};

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/codex-tui/real-session-0.146.0.json"
);

function loadFixture(): CodexTuiFixture {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as CodexTuiFixture;
}

function visibleText(raw: string): string {
  const carry = createEscapeCarry();
  let text = "";
  for (let offset = 0; offset < raw.length; offset += 512) {
    text += stripTerminalEscapes(carry(raw.slice(offset, offset + 512)));
  }
  return text;
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
});
