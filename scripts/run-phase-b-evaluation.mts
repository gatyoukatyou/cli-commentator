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

function configuredModel(provider: string): string {
  if (provider === "gemini") return process.env.GEMINI_MODEL || "gemini-2.0-flash";
  if (provider === "anthropic") return process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20240620";
  if (provider === "openai") return process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (provider === "groq") return process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  if (provider === "local") return process.env.LOCAL_MODEL || "llama3.2";
  return provider === "mock" ? "mock" : "unknown";
}

function missingProviderCredential(provider: string): string | undefined {
  const required: Record<string, string> = {
    gemini: "GOOGLE_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    groq: "GROQ_API_KEY",
  };
  const name = required[provider];
  return name && !process.env[name] ? name : undefined;
}

function markdownReport(
  baseline: PhaseBReplayResult,
  candidate: PhaseBReplayResult,
  matches: boolean,
  llmStatus: string
): string {
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
  const providerRows = (candidate.providerComparisons ?? []).map(
    ({ offsetMs, rules, llm, measurement }) => [
      offsetMs,
      rules.narration ?? "-",
      llm.narration ?? "-",
      measurement.result,
      measurement.durationMs,
      measurement.inputTokens,
      measurement.outputTokens,
    ]
  );
  const providerMetrics = candidate.providerMetrics;
  return [
    "# Phase B fixture replay report",
    "",
    `- fixture: \`${candidate.fixtureId}\``,
    `- snapshot: ${matches ? "MATCH" : "DIFF"}`,
    "- scope: 28 sanitized lines / 5 extracted events",
    `- LLM measurement: ${llmStatus}`,
    ...(providerMetrics
      ? [
          `- provider: \`${providerMetrics.provider}\``,
          `- model: \`${providerMetrics.model}\``,
          `- COMMENT_TIMEOUT_MS: ${providerMetrics.timeoutMs}`,
        ]
      : []),
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
    ...(providerMetrics
      ? [
          "## Context-aware rules / LLM provider comparison",
          "",
          `- successes within timeout: ${providerMetrics.withinTimeoutSuccesses}/${providerMetrics.attempted} (${(providerMetrics.withinTimeoutSuccessRate * 100).toFixed(1)}%)`,
          `- results: \`${JSON.stringify(providerMetrics.results)}\``,
          `- tokens: input=${providerMetrics.inputTokens}, output=${providerMetrics.outputTokens}`,
          "",
          "| offset (ms) | rules | LLM | result | duration (ms) | input tokens | output tokens |",
          "|---:|---|---|---|---:|---:|---:|",
          ...providerRows.map((row) => `| ${row.join(" | ")} |`),
          "",
        ]
      : []),
  ].join("\n");
}

const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8")) as PhaseBReplayFixture;
const withLlm = process.argv.includes("--with-llm");
const llmProvider = process.env.LLM_PROVIDER ?? "disabled";
const missingCredential = withLlm ? missingProviderCredential(llmProvider) : undefined;
const llmEnabled = withLlm && llmProvider !== "disabled" && !missingCredential;
const llmModel = configuredModel(llmProvider);
if (withLlm && missingCredential) {
  console.warn(`Skipping LLM measurement: ${missingCredential} is not set`);
}
if (withLlm && llmProvider === "disabled") {
  console.warn("Skipping LLM measurement: LLM_PROVIDER is not set");
}
const candidate = await replayPhaseBFixture(
  fixture,
  llmEnabled
    ? {
        llmProvider: llmProvider as NonNullable<Parameters<typeof replayPhaseBFixture>[1]>["llmProvider"],
        llmModel,
      }
    : {}
);
const snapshotCandidate = { ...candidate };
delete snapshotCandidate.providerComparisons;
delete snapshotCandidate.providerMetrics;

if (process.argv.includes("--update-baseline")) {
  await fs.writeFile(baselinePath, `${JSON.stringify(snapshotCandidate, null, 2)}\n`, "utf8");
  console.log(`Updated baseline: ${baselinePath}`);
  process.exit(0);
}

const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8")) as PhaseBReplayResult;
const matches = JSON.stringify(baseline) === JSON.stringify(snapshotCandidate);
const outputDir = path.resolve(getArg("--output-dir") ?? path.join(os.tmpdir(), "cli-commentator-phase-b-eval"));
await fs.mkdir(outputDir, { recursive: true });
const candidatePath = path.join(outputDir, "candidate.json");
const reportPath = path.join(outputDir, "report.md");
await fs.writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
const llmStatus = llmEnabled
  ? "enabled"
  : withLlm
    ? `skipped (${missingCredential ? `${missingCredential} is not set` : "LLM_PROVIDER is not set"})`
    : "disabled";
await fs.writeFile(reportPath, markdownReport(baseline, candidate, matches, llmStatus), "utf8");

console.log(`Candidate: ${candidatePath}`);
console.log(`Report: ${reportPath}`);
console.log(`Snapshot: ${matches ? "MATCH" : "DIFF"}`);
if (!matches) process.exitCode = 1;
