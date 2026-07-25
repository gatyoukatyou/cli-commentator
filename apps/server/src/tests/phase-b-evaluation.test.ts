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
import {
  buildPhaseBEvaluationArtifacts,
  evaluatedPhaseOptions,
} from "../evaluation/phase-b-artifacts.js";
import { SESSION_PHASE_LABELS } from "../session-context.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, "../../test/fixtures");

async function loadFixture(
  name = "phase-b-codex-session.json"
): Promise<PhaseBReplayFixture> {
  return JSON.parse(
    await fs.readFile(path.join(fixturesDir, name), "utf8")
  ) as PhaseBReplayFixture;
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

  it("compares context-aware rules with an LLM provider and aggregates measurements", async () => {
    const fixture = await loadFixture();
    const result = await replayPhaseBFixture(fixture, {
      llmProvider: "mock",
      llmModel: "mock",
    });

    expect(result.providerComparisons).toHaveLength(4);
    expect(result.providerComparisons?.[0]).toMatchObject({
      eventType: "search",
      rules: {
        narration: expect.any(String),
        explanation: expect.any(String),
      },
      llm: {
        narration: expect.stringContaining("[mock-"),
        explanation: expect.stringContaining("[mock-"),
      },
      measurement: {
        result: "comment_ok",
        provider: "mock/mock",
        inputTokens: 20,
        outputTokens: 40,
      },
    });
    expect(result.providerMetrics).toEqual({
      provider: "mock",
      model: "mock",
      timeoutMs: 3000,
      attempted: 4,
      withinTimeoutSuccesses: 4,
      withinTimeoutSuccessRate: 1,
      results: {
        comment_ok: 4,
        comment_timeout: 0,
        comment_aborted: 0,
        comment_llm_error: 0,
      },
      inputTokens: 80,
      outputTokens: 160,
    });
  });

  it("builds an error fixture with verification checkpoints", async () => {
    const fixture = await loadFixture("phase-b-codex-lifecycle-error.json");
    const result = await replayPhaseBFixture(fixture);
    const artifacts = buildPhaseBEvaluationArtifacts(result);

    expect(result.metrics.eventsByType).toEqual({ test: 1, error: 3 });
    expect(result.contextTimeline.map(({ phase }) => phase)).toEqual([
      "verification",
      "verification",
      "verification",
      "verification",
    ]);
    expect(artifacts.answerKey.checkpoints).toHaveLength(4);
    expect(
      artifacts.answerKey.checkpoints.every(({ phase }) => phase === "verification")
    ).toBe(true);
  });

  it("exports a waiting HUMAN checkpoint and speech-only blind material", async () => {
    const fixture = await loadFixture("phase-b-codex-approval.json");
    const result = await replayPhaseBFixture(fixture);
    const artifacts = buildPhaseBEvaluationArtifacts(result);
    const waitingCheckpoint = artifacts.answerKey.checkpoints.find(
      ({ phase }) => phase === "waiting"
    );

    expect(waitingCheckpoint).toMatchObject({
      phaseLabel: SESSION_PHASE_LABELS.waiting,
      humanRequired: true,
      objective: fixture.taskContext.objective,
    });
    expect(artifacts.answerKey.phaseOptions).toEqual(evaluatedPhaseOptions());
    expect(artifacts.answerKey.phaseOptions).not.toContainEqual(
      expect.objectContaining({ phase: "unknown" })
    );
    expect(artifacts.blindSpeech).toHaveLength(
      artifacts.answerKey.checkpoints.length
    );
    for (const item of artifacts.blindSpeech) {
      expect(Object.keys(item).sort()).toEqual(["cpId", "speechText"]);
      expect(item.speechText.trim()).not.toBe("");
    }
    expect(JSON.stringify(artifacts.blindSpeech)).not.toMatch(
      /narration|explanation|humanRequired|phase|provider|withoutContext|withContext/u
    );
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
