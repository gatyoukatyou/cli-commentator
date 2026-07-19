import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  comparePhaseBEventTypes,
  replayPhaseBFixture,
  type PhaseBReplayFixture,
  type PhaseBReplayResult,
} from "../apps/server/src/evaluation/phase-b-replay.js";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const fixturePath = path.join(repoRoot, "apps/server/test/fixtures/phase-b-codex-session.json");
const baselinePath = path.join(repoRoot, "apps/server/test/fixtures/phase-b-codex-session.expected.json");

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function markdownReport(baseline: PhaseBReplayResult, candidate: PhaseBReplayResult, matches: boolean): string {
  const rows = [
    ["events", baseline.metrics.events, candidate.metrics.events],
    ["commentaries", baseline.metrics.commentaries, candidate.metrics.commentaries],
    ["suppressed", baseline.metrics.suppressed, candidate.metrics.suppressed],
    ["glossaryNotes", baseline.metrics.glossaryNotes, candidate.metrics.glossaryNotes],
    ["exactNarrationRepeats", baseline.metrics.exactNarrationRepeats, candidate.metrics.exactNarrationRepeats],
    ["spokenCommentaries", baseline.metrics.spokenCommentaries ?? 0, candidate.metrics.spokenCommentaries],
    ["displayOnlyCommentaries", baseline.metrics.displayOnlyCommentaries ?? 0, candidate.metrics.displayOnlyCommentaries],
    ["maxSpeechSentences", baseline.metrics.maxSpeechSentences ?? 0, candidate.metrics.maxSpeechSentences],
    ["multiSentenceSpeech", baseline.metrics.multiSentenceSpeech ?? 0, candidate.metrics.multiSentenceSpeech],
    ["rawCommandSpeech", baseline.metrics.rawCommandSpeech ?? 0, candidate.metrics.rawCommandSpeech],
    ["repeatedProgressSpeechWithin30s", baseline.metrics.repeatedProgressSpeechWithin30s ?? 0, candidate.metrics.repeatedProgressSpeechWithin30s],
    ["glossaryRedisplays", baseline.metrics.glossaryRedisplays ?? 0, candidate.metrics.glossaryRedisplays],
    ["urgentMisses", baseline.metrics.urgentMisses ?? 0, candidate.metrics.urgentMisses],
    ["falseUrgent", baseline.metrics.falseUrgent ?? 0, candidate.metrics.falseUrgent],
  ];
  const eventTypeRows = comparePhaseBEventTypes(baseline.metrics, candidate.metrics);
  const contextRows = candidate.contextTimeline.map(({ offsetMs, eventType, phase, previousPhase, phaseChanged, target, humanRequired, speechDisposition, speechReason }) => [
    offsetMs,
    eventType,
    phase,
    phaseChanged ? `${previousPhase} → ${phase}` : "-",
    target ?? "-",
    humanRequired ? "yes" : "no",
    `${speechDisposition}:${speechReason}`,
  ]);
  const commentaryRows = candidate.commentaryComparisons.map(({ offsetMs, withoutContext, withContext }) => [
    offsetMs,
    withoutContext.narration ?? "-",
    withContext.narration ?? "-",
    withContext.speech?.text ?? "-",
  ]);
  return [
    "# Phase B fixture replay report",
    "",
    `- fixture: \`${candidate.fixtureId}\``,
    `- snapshot: ${matches ? "MATCH" : "DIFF"}`,
    "- scope: 28 sanitized lines / 5 extracted events",
    "",
    "| metric | baseline | candidate |",
    "|---|---:|---:|",
    ...rows.map(([name, before, after]) => `| ${name} | ${before} | ${after} |`),
    `| speechSuppressionsByReason | ${JSON.stringify(baseline.metrics.speechSuppressionsByReason ?? {})} | ${JSON.stringify(candidate.metrics.speechSuppressionsByReason)} |`,
    "",
    "## Event classifications",
    "",
    "| event type | baseline | candidate |",
    "|---|---:|---:|",
    ...eventTypeRows.map(({ eventType, baseline: before, candidate: after }) =>
      `| ${eventType} | ${before} | ${after} |`
    ),
    "",
    "## Session context timeline",
    "",
    "| offset (ms) | event | phase | transition | target | HUMAN required | speech |",
    "|---:|---|---|---|---|---|---|",
    ...contextRows.map((row) => `| ${row.join(" | ")} |`),
    "",
    "## Commentary with / without context",
    "",
    "| offset (ms) | without context | with context | speech text |",
    "|---:|---|---|---|",
    ...commentaryRows.map((row) => `| ${row.join(" | ")} |`),
    "",
  ].join("\n");
}

const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8")) as PhaseBReplayFixture;
const candidate = await replayPhaseBFixture(fixture);

if (process.argv.includes("--update-baseline")) {
  await fs.writeFile(baselinePath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  console.log(`Updated baseline: ${baselinePath}`);
  process.exit(0);
}

const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8")) as PhaseBReplayResult;
const matches = JSON.stringify(baseline) === JSON.stringify(candidate);
const outputDir = path.resolve(getArg("--output-dir") ?? path.join(os.tmpdir(), "cli-commentator-phase-b-eval"));
await fs.mkdir(outputDir, { recursive: true });
const candidatePath = path.join(outputDir, "candidate.json");
const reportPath = path.join(outputDir, "report.md");
await fs.writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
await fs.writeFile(reportPath, markdownReport(baseline, candidate, matches), "utf8");

console.log(`Candidate: ${candidatePath}`);
console.log(`Report: ${reportPath}`);
console.log(`Snapshot: ${matches ? "MATCH" : "DIFF"}`);
if (!matches) process.exitCode = 1;
