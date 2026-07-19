import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  replayPhaseBFixture,
  type PhaseBReplayFixture,
} from "../evaluation/phase-b-replay.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.resolve(__dirname, "../../test/fixtures/phase-b-codex-session.json");

async function loadFixture(): Promise<PhaseBReplayFixture> {
  return JSON.parse(await fs.readFile(fixturePath, "utf8")) as PhaseBReplayFixture;
}

describe("Phase B evaluation replay", () => {
  it("replays the minimal sanitized session deterministically", async () => {
    const fixture = await loadFixture();
    const result = await replayPhaseBFixture(fixture);

    expect(fixture.notice).toEqual([
      "This fixture was derived from a real Codex CLI session and sanitized.",
      "Identifiers, paths, timestamps, and user-authored content are synthetic.",
    ]);
    expect(fixture.lines).toHaveLength(28);
    expect(result.metrics).toMatchObject({
      events: 5,
      commentaries: 4,
      suppressed: 1,
      eventsByType: { search: 2, stdout: 2, test: 1 },
    });
    expect(result).toMatchSnapshot();
  });
});
