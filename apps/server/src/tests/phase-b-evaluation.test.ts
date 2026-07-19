import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  comparePhaseBEventTypes,
  hasRawCommandSpeech,
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
  it.each([
    "git status を確認しています。",
    "pnpm test を実行しています。",
    "gh pr view を確認しています。",
  ])("detects common raw commands with the production TTS policy: %s", (speech) => {
    expect(hasRawCommandSpeech(speech)).toBe(true);
  });

  it("replays the minimal sanitized session deterministically", async () => {
    const fixture = await loadFixture();
    const result = await replayPhaseBFixture(fixture);

    expect(fixture.notice).toEqual([
      "This fixture was derived from a real Codex CLI session and sanitized.",
      "Identifiers, paths, timestamps, and user-authored content are synthetic.",
    ]);
    expect(fixture.lines).toHaveLength(28);
    expect(result.taskContext).toEqual(fixture.taskContext);
    expect(result.metrics).toMatchObject({
      events: 5,
      commentaries: 4,
      suppressed: 1,
      eventsByType: { search: 2, read: 3 },
      glossaryNotes: 1,
      exactNarrationRepeats: 0,
      spokenCommentaries: 4,
      displayOnlyCommentaries: 0,
      speechSuppressionsByReason: {},
      maxSpeechSentences: 1,
      multiSentenceSpeech: 0,
      rawCommandSpeech: 0,
      repeatedProgressSpeechWithin30s: 0,
      glossaryRedisplays: 0,
      urgentMisses: 0,
      falseUrgent: 0,
    });
    expect(result.contextTimeline.map(({ phase }) => phase)).toEqual([
      "investigation",
      "investigation",
      "investigation",
      "investigation",
      "investigation",
    ]);
    expect(result.contextTimeline[0]).toMatchObject({
      previousPhase: "unknown",
      phaseChanged: true,
      humanRequired: false,
    });
    expect(result.commentaryComparisons[0].withContext.explanation).toContain(
      fixture.taskContext.objective.slice(0, 24)
    );
    expect(result.commentaryComparisons.some(({ withoutContext, withContext }) =>
      withoutContext.narration !== withContext.narration
    )).toBe(true);
    expect(result).toMatchSnapshot();
  });

  it("compares event classifications in a stable order", () => {
    expect(comparePhaseBEventTypes(
      {
        events: 2,
        commentaries: 0,
        suppressed: 0,
        eventsByType: { test: 1, search: 1 },
        glossaryNotes: 0,
        exactNarrationRepeats: 0,
        spokenCommentaries: 0,
        displayOnlyCommentaries: 0,
        speechSuppressionsByReason: {},
        maxSpeechSentences: 0,
        multiSentenceSpeech: 0,
        rawCommandSpeech: 0,
        repeatedProgressSpeechWithin30s: 0,
        glossaryRedisplays: 0,
        urgentMisses: 0,
        falseUrgent: 0,
      },
      {
        events: 2,
        commentaries: 0,
        suppressed: 0,
        eventsByType: { read: 1, search: 1 },
        glossaryNotes: 0,
        exactNarrationRepeats: 0,
        spokenCommentaries: 0,
        displayOnlyCommentaries: 0,
        speechSuppressionsByReason: {},
        maxSpeechSentences: 0,
        multiSentenceSpeech: 0,
        rawCommandSpeech: 0,
        repeatedProgressSpeechWithin30s: 0,
        glossaryRedisplays: 0,
        urgentMisses: 0,
        falseUrgent: 0,
      }
    )).toEqual([
      { eventType: "read", baseline: 0, candidate: 1 },
      { eventType: "search", baseline: 1, candidate: 1 },
      { eventType: "test", baseline: 1, candidate: 0 },
    ]);
  });
});
