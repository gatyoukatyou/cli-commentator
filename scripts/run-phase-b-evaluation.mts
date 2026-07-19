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
  ];
  const eventTypeRows = comparePhaseBEventTypes(baseline.metrics, candidate.metrics);
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
    "",
    "## Event classifications",
    "",
    "| event type | baseline | candidate |",
    "|---|---:|---:|",
    ...eventTypeRows.map(({ eventType, baseline: before, candidate: after }) =>
      `| ${eventType} | ${before} | ${after} |`
    ),
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
