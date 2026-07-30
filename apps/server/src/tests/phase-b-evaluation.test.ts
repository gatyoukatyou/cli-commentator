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
  countRepeatedSpeechWithinWindow,
  normalizeSpeechRepetitionKey,
} from "@cli-commentator/shared";
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
    expect(fixture.lines).toHaveLength(29);
    expect(result.taskContext).toEqual(fixture.taskContext);
    expect(result.metrics).toMatchObject({
      events: 6,
      commentaries: 5,
      suppressed: 1,
      eventsByType: { search: 2, read: 3, test: 1 },
      glossaryNotes: 2,
      exactNarrationRepeats: 0,
      spokenCommentaries: 5,
      displayOnlyCommentaries: 0,
      speechSuppressionsByReason: {},
      maxSpeechSentences: 1,
      multiSentenceSpeech: 0,
      rawCommandSpeech: 0,
      repeatedProgressSpeechWithin120s: 0,
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
      "verification",
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

  it("counts four normalized repeats in the sanitized observed-session fixture", async () => {
    const fixture = JSON.parse(
      await fs.readFile(
        path.join(fixturesDir, "repeated-progress-speech.json"),
        "utf8"
      )
    ) as { samples: Array<{ offsetMs: number; text: string }> };
    expect(new Set(fixture.samples.map(({ text }) =>
      normalizeSpeechRepetitionKey(text)
    ))).toHaveLength(1);
    expect(countRepeatedSpeechWithinWindow(
      fixture.samples.map(({ offsetMs, text }) => ({ timestampMs: offsetMs, text }))
    )).toBe(4);
  });

  it("normalizes quoted progress style without collapsing different facts", () => {
    const confirmationStyles = [
      "「orchestrator.ts」を確認しています。",
      "「orchestrator.ts」を確認しとるで。",
      "「orchestrator.ts」を確認しているのだ。",
    ];
    expect(
      new Set(confirmationStyles.map(normalizeSpeechRepetitionKey))
    ).toHaveLength(1);
    expect(countRepeatedSpeechWithinWindow(
      confirmationStyles.map((text, index) => ({
        timestampMs: index * 1_000,
        text,
      }))
    )).toBe(2);

    const differentQuotedFacts = [
      "「handoff の最新ステータスを見せて」っちゅうログが出てきたで！",
      "「handoff の最新ステータスを見せて」っちゅう入力があって、最新の…中身が表示されたで！",
    ];
    expect(
      new Set(differentQuotedFacts.map(normalizeSpeechRepetitionKey))
    ).toHaveLength(2);
    expect(countRepeatedSpeechWithinWindow(
      differentQuotedFacts.map((text, index) => ({
        timestampMs: index * 1_000,
        text,
      }))
    )).toBe(0);
  });

  it("keeps distinct unquoted progress reports on the text key path", () => {
    const unquotedFacts = [
      "画面に謎の制御コードみたいな文字列がずらっと並んで出てきとるな。",
      "画面にマウスのドラッグ操作の座標データらしき文字列がずらっと並んどるな。",
    ];
    const keys = unquotedFacts.map(normalizeSpeechRepetitionKey);
    expect(keys).toHaveLength(2);
    expect(keys.every((key) => key.startsWith("text:"))).toBe(true);
    expect(new Set(keys)).toHaveLength(2);
    expect(countRepeatedSpeechWithinWindow(
      unquotedFacts.map((text, index) => ({
        timestampMs: index * 1_000,
        text,
      }))
    )).toBe(0);
  });

  it("compares context-aware rules with an LLM provider and aggregates measurements", async () => {
    const fixture = await loadFixture();
    const result = await replayPhaseBFixture(fixture, {
      llmProvider: "mock",
      llmModel: "mock",
    });

    expect(result.providerComparisons).toHaveLength(5);
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
      attempted: 5,
      withinTimeoutSuccesses: 5,
      withinTimeoutSuccessRate: 1,
      results: {
        comment_ok: 5,
        comment_timeout: 0,
        comment_aborted: 0,
        comment_llm_error: 0,
      },
      inputTokens: 100,
      outputTokens: 200,
    });
  });

  it("builds an error fixture with verification checkpoints", async () => {
    const fixture = await loadFixture("phase-b-codex-lifecycle-error.json");
    const result = await replayPhaseBFixture(fixture);
    const artifacts = buildPhaseBEvaluationArtifacts(result);

    expect(result.metrics.eventsByType).toEqual({ read: 1, test: 1, error: 3 });
    expect(result.contextTimeline.map(({ phase }) => phase)).toEqual([
      "investigation",
      "verification",
      "verification",
      "verification",
      "verification",
    ]);
    expect(artifacts.answerKey.checkpoints).toHaveLength(5);
    expect(new Set(
      artifacts.answerKey.checkpoints.map(({ phase }) => phase)
    )).toEqual(new Set(["investigation", "verification"]));
  });

  it("exports a waiting HUMAN checkpoint and speech-only blind material", async () => {
    const fixture = await loadFixture("phase-b-codex-approval.json");
    const result = await replayPhaseBFixture(fixture);
    const artifacts = buildPhaseBEvaluationArtifacts(result);
    const waitingCheckpoint = artifacts.answerKey.checkpoints.find(
      ({ phase }) => phase === "waiting"
    );
    const humanRequiredCheckpoints = artifacts.answerKey.checkpoints.filter(
      ({ humanRequired }) => humanRequired
    );

    expect(waitingCheckpoint).toMatchObject({
      phaseLabel: SESSION_PHASE_LABELS.waiting,
      humanRequired: true,
      objective: fixture.taskContext.objective,
    });
    expect(humanRequiredCheckpoints).toHaveLength(2);
    expect(new Set(
      artifacts.answerKey.checkpoints.map(({ phase }) => phase)
    )).toEqual(new Set(["waiting", "editing"]));
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
    expect(artifacts.blindSpeech[0]?.speechText).toBe(
      result.commentaryComparisons[0].withContext.speech?.text
    );
    expect(artifacts.blindSpeech[0]?.speechText).toContain("テスト");
    expect(artifacts.blindSpeech[1]?.speechText).toContain(
      SESSION_PHASE_LABELS.editing
    );
    expect(artifacts.blindSpeech[2]?.speechText).toContain("質問1");
    expect(JSON.stringify(artifacts.blindSpeech)).not.toMatch(
      /narration|explanation|humanRequired|phase|provider|withoutContext|withContext/u
    );
    expect(result.commentaryComparisons[0].withContext.speech?.text).toContain(
      "実行許可"
    );
  });

  it("records a skipped checkpoint instead of throwing when speech is missing", async () => {
    const fixture = await loadFixture();
    const result = await replayPhaseBFixture(fixture);
    const first = result.commentaryComparisons[0];
    const suppressedResult = {
      ...result,
      commentaryComparisons: [
        {
          ...first,
          withContext: {
            ...first.withContext,
            speech: undefined,
          },
        },
        ...result.commentaryComparisons.slice(1),
      ],
    };

    const artifacts = buildPhaseBEvaluationArtifacts(suppressedResult);

    expect(artifacts.answerKey.skippedCheckpoints).toContainEqual({
      offsetMs: first.offsetMs,
      eventType: first.eventType,
      reason: "speech_not_spoken",
      speechDisposition: "missing",
      speechReason: "new_task",
    });
    expect(artifacts.answerKey.checkpoints).toHaveLength(
      result.commentaryComparisons.length - 1
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
        repeatedProgressSpeechWithin120s: 0,
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
        repeatedProgressSpeechWithin120s: 0,
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
