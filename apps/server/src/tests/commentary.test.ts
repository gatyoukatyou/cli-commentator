import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Event, Style } from "../types.js";

type CommentaryFixture = {
  id: string;
  intent: string;
  event: Event;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../../test/fixtures/commentary-quality.events.json");

const styles: Style[] = ["standard", "kansai", "zundamon"];

async function loadFixtures(): Promise<CommentaryFixture[]> {
  const raw = await fs.readFile(fixturesPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("commentary-quality fixtures must be a non-empty array");
  }

  return parsed as CommentaryFixture[];
}

describe("commentary quality fixtures", () => {
  const originalProvider = process.env.LLM_PROVIDER;

  beforeEach(() => {
    delete process.env.LLM_PROVIDER;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = originalProvider;
  });

  it("renders styles consistently", async () => {
    const fixtures = await loadFixtures();
    const { comment } = await import("../styles/index.js");

    const output = await Promise.all(
      fixtures.map(async (fixture) => ({
        id: fixture.id,
        intent: fixture.intent,
        outputs: await Promise.all(
          styles.map(async (style) => ({
            style,
            text: await comment(fixture.event, style),
          }))
        ),
      }))
    );

    expect(output).toMatchSnapshot();
  });
});
