#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STARTUP_FAILURE_PREFIX = "[startup/failure] ";
const SERVER_STATE_EVENT_PREFIX = "[server/state-event] ";

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function formatDurationMs(startTime, testResults) {
  if (!Number.isFinite(startTime)) return "n/a";
  const latestEnd = testResults
    .map((suite) => Number(suite?.endTime))
    .filter((v) => Number.isFinite(v))
    .reduce((max, v) => Math.max(max, v), startTime);

  const durationMs = Math.max(0, latestEnd - startTime);
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function collectFailures(report) {
  const failures = [];
  for (const suite of report.testResults ?? []) {
    const suiteName = String(suite?.name ?? "(unknown suite)");
    for (const assertion of suite.assertionResults ?? []) {
      if (assertion?.status !== "failed") continue;
      const fullName = String(assertion?.fullName ?? assertion?.title ?? "(unknown test)");
      const failureMessages = Array.isArray(assertion?.failureMessages)
        ? assertion.failureMessages.map((m) => String(m))
        : [];
      failures.push({
        suiteName,
        fullName,
        failureMessages,
      });
    }
  }
  return failures;
}

function incrementCounter(counter, key) {
  const normalizedKey = key && String(key).trim().length > 0 ? String(key) : "(unknown)";
  counter.set(normalizedKey, (counter.get(normalizedKey) ?? 0) + 1);
}

function toSortedCountList(counter) {
  return [...counter.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .map(([value, count]) => ({ value, count }));
}

function formatCountList(items, limit = 5) {
  if (!items || items.length === 0) return "none";
  return items
    .slice(0, limit)
    .map((item) => `\`${item.value}\` x${item.count}`)
    .join(", ");
}

function parseStructuredLogLine(line) {
  if (line.startsWith(STARTUP_FAILURE_PREFIX)) {
    return {
      type: "startupFailure",
      payload: JSON.parse(line.slice(STARTUP_FAILURE_PREFIX.length)),
    };
  }
  if (line.startsWith(SERVER_STATE_EVENT_PREFIX)) {
    return {
      type: "serverStateEvent",
      payload: JSON.parse(line.slice(SERVER_STATE_EVENT_PREFIX.length)),
    };
  }
  return null;
}

export function parseStructuredLogLines(raw) {
  const startupFailures = [];
  const serverStateEvents = [];
  const parseErrors = [];

  for (const [index, line] of String(raw ?? "").split(/\r?\n/).entries()) {
    if (!line.startsWith(STARTUP_FAILURE_PREFIX) && !line.startsWith(SERVER_STATE_EVENT_PREFIX)) continue;
    try {
      const parsed = parseStructuredLogLine(line);
      if (!parsed) continue;
      if (parsed.type === "startupFailure") startupFailures.push(parsed.payload);
      else serverStateEvents.push(parsed.payload);
    } catch (error) {
      parseErrors.push({
        lineNumber: index + 1,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { startupFailures, serverStateEvents, parseErrors };
}

function summarizeScenario(fileName, parsed) {
  const startupCodes = new Set();
  const startupFallbackReasons = new Set();
  const startupContexts = new Set();
  const stateTriggers = new Set();

  for (const failure of parsed.startupFailures) {
    if (failure?.code) startupCodes.add(String(failure.code));
    if (failure?.fallback?.reason) startupFallbackReasons.add(String(failure.fallback.reason));
    if (failure?.context) startupContexts.add(String(failure.context));
  }

  for (const event of parsed.serverStateEvents) {
    if (event?.trigger) stateTriggers.add(String(event.trigger));
  }

  return {
    scenario: path.basename(fileName, path.extname(fileName)),
    fileName,
    startupFailureCount: parsed.startupFailures.length,
    serverStateEventCount: parsed.serverStateEvents.length,
    startupCodes: [...startupCodes],
    startupFallbackReasons: [...startupFallbackReasons],
    startupContexts: [...startupContexts],
    stateTriggers: [...stateTriggers],
    parseErrors: parsed.parseErrors,
  };
}

export async function collectStructuredLogCaptureSummary(captureDir) {
  const summary = {
    found: false,
    captureDir,
    captureFiles: [],
    scenarioCount: 0,
    startupFailureCount: 0,
    serverStateEventCount: 0,
    startupFailureCodes: [],
    fallbackReasons: [],
    serverStateTriggers: [],
    scenarios: [],
    parseErrors: [],
  };

  if (!captureDir || !(await fileExists(captureDir))) {
    return summary;
  }

  const entries = await fs.readdir(captureDir, { withFileTypes: true });
  const logFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  summary.found = true;
  summary.captureFiles = logFiles;
  summary.scenarioCount = logFiles.length;

  const startupCodeCounts = new Map();
  const fallbackReasonCounts = new Map();
  const stateTriggerCounts = new Map();

  for (const fileName of logFiles) {
    const raw = await fs.readFile(path.join(captureDir, fileName), "utf-8");
    const parsed = parseStructuredLogLines(raw);
    const scenario = summarizeScenario(fileName, parsed);
    summary.scenarios.push(scenario);
    summary.parseErrors.push(
      ...scenario.parseErrors.map((error) => ({
        fileName,
        ...error,
      }))
    );

    summary.startupFailureCount += parsed.startupFailures.length;
    summary.serverStateEventCount += parsed.serverStateEvents.length;

    for (const failure of parsed.startupFailures) {
      incrementCounter(startupCodeCounts, failure?.code);
      incrementCounter(fallbackReasonCounts, failure?.fallback?.reason);
    }
    for (const event of parsed.serverStateEvents) {
      incrementCounter(stateTriggerCounts, event?.trigger);
    }
  }

  summary.startupFailureCodes = toSortedCountList(startupCodeCounts);
  summary.fallbackReasons = toSortedCountList(fallbackReasonCounts);
  summary.serverStateTriggers = toSortedCountList(stateTriggerCounts);
  return summary;
}

function renderStructuredLogSection(structuredSummary) {
  const lines = ["### Structured Log Coverage"];

  if (!structuredSummary.found) {
    lines.push(`- Captures: not found (\`${structuredSummary.captureDir}\`)`);
    return lines;
  }

  lines.push(`- Capture files: ${structuredSummary.scenarioCount} (\`${structuredSummary.captureDir}\`)`);
  lines.push(
    `- Startup failures: ${structuredSummary.startupFailureCount} (${formatCountList(structuredSummary.startupFailureCodes)})`
  );
  lines.push(`- Fallback reasons: ${formatCountList(structuredSummary.fallbackReasons)}`);
  lines.push(
    `- Server state events: ${structuredSummary.serverStateEventCount} (${formatCountList(structuredSummary.serverStateTriggers)})`
  );

  if (structuredSummary.parseErrors.length > 0) {
    lines.push(`- Parse errors: ${structuredSummary.parseErrors.length}`);
  }

  if (structuredSummary.scenarios.length > 0) {
    lines.push("", "### Structured Log Scenarios");
    for (const scenario of structuredSummary.scenarios) {
      const startupInfo =
        scenario.startupFailureCount > 0
          ? `${scenario.startupFailureCount} startup/failure (${scenario.startupCodes.join(", ") || "unknown"})`
          : "no startup/failure";
      const fallbackInfo =
        scenario.startupFallbackReasons.length > 0
          ? `fallback=${scenario.startupFallbackReasons.join(", ")}`
          : "fallback=none";
      const stateInfo =
        scenario.serverStateEventCount > 0
          ? `${scenario.serverStateEventCount} state-event (${scenario.stateTriggers.join(", ") || "unknown"})`
          : "no state-event";
      lines.push(`- \`${scenario.scenario}\`: ${startupInfo}; ${fallbackInfo}; ${stateInfo}`);
    }
  }

  return lines;
}

function renderSummary(reportPath, report, failures, structuredSummary) {
  const success = Boolean(report?.success);
  const icon = success ? "✅" : "❌";
  const duration = formatDurationMs(Number(report?.startTime), report?.testResults ?? []);
  const totalTests = Number(report?.numTotalTests ?? 0);
  const passedTests = Number(report?.numPassedTests ?? 0);
  const failedTests = Number(report?.numFailedTests ?? 0);
  const pendingTests = Number(report?.numPendingTests ?? 0);
  const totalSuites = Number(report?.numTotalTestSuites ?? 0);
  const passedSuites = Number(report?.numPassedTestSuites ?? 0);
  const failedSuites = Number(report?.numFailedTestSuites ?? 0);

  const lines = [
    "## Failure Regression Summary",
    "",
    `${icon} Result: ${success ? "PASS" : "FAIL"}`,
    `- Duration: ${duration}`,
    `- Suites: ${passedSuites}/${totalSuites} passed (${failedSuites} failed)`,
    `- Tests: ${passedTests}/${totalTests} passed (${failedTests} failed, ${pendingTests} pending)`,
    `- Report: \`${reportPath}\``,
  ];

  if (failures.length > 0) {
    lines.push("", "### Failed Tests");
    for (const failure of failures.slice(0, 20)) {
      lines.push(`- \`${failure.fullName}\` (${path.basename(failure.suiteName)})`);
      const firstMessage = failure.failureMessages[0]?.trim();
      if (firstMessage) {
        const firstLine = firstMessage.split("\n")[0];
        lines.push(`  - ${firstLine}`);
      }
    }
    if (failures.length > 20) {
      lines.push(`- ... and ${failures.length - 20} more failed tests`);
    }
  }

  if (structuredSummary) {
    lines.push("", ...renderStructuredLogSection(structuredSummary));
  }

  return `${lines.join("\n")}\n`;
}

function renderMissingReportSummary(reportPath) {
  return [
    "## Failure Regression Summary",
    "",
    "⚠️ Result report was not found.",
    `- Expected report: \`${reportPath}\``,
    "- Check the previous `Run failure regression suite` step output.",
    "",
  ].join("\n");
}

async function writeStructuredLogSummaryArtifact(outputPath, structuredSummary) {
  if (!outputPath || !structuredSummary) return;
  const structuredSummaryPath = path.join(path.dirname(outputPath), "structured-log-summary.json");
  await fs.writeFile(structuredSummaryPath, `${JSON.stringify(structuredSummary, null, 2)}\n`, "utf-8");
}

export async function summarizeFailureRegression({
  reportPath,
  outputPath,
  captureDir,
}) {
  const resolvedCaptureDir = captureDir ?? path.join(path.dirname(outputPath ?? reportPath), "structured-log-captures");

  if (!reportPath) {
    throw new Error("Usage: node scripts/summarize-failure-regression.mjs <reportPath> [outputPath] [captureDir]");
  }

  const structuredSummary = await collectStructuredLogCaptureSummary(resolvedCaptureDir);
  let markdown;
  if (!(await fileExists(reportPath))) {
    markdown = renderMissingReportSummary(reportPath);
  } else {
    const raw = await fs.readFile(reportPath, "utf-8");
    const report = JSON.parse(raw);
    const failures = collectFailures(report);
    markdown = renderSummary(reportPath, report, failures, structuredSummary);
  }

  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, markdown, "utf-8");
    await writeStructuredLogSummaryArtifact(outputPath, structuredSummary);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, "utf-8");
  }

  process.stdout.write(markdown);
}

async function main() {
  const reportPath = process.argv[2];
  const outputPath = process.argv[3];
  const captureDir = process.argv[4];
  await summarizeFailureRegression({ reportPath, outputPath, captureDir });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[failure-regression-summary] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
