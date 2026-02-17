#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

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

function renderSummary(reportPath, report, failures) {
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

async function main() {
  const reportPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!reportPath) {
    console.error("Usage: node scripts/summarize-failure-regression.mjs <reportPath> [outputPath]");
    process.exitCode = 1;
    return;
  }

  let markdown;
  if (!(await fileExists(reportPath))) {
    markdown = renderMissingReportSummary(reportPath);
  } else {
    const raw = await fs.readFile(reportPath, "utf-8");
    const report = JSON.parse(raw);
    const failures = collectFailures(report);
    markdown = renderSummary(reportPath, report, failures);
  }

  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, markdown, "utf-8");
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, "utf-8");
  }

  process.stdout.write(markdown);
}

main().catch((err) => {
  console.error(`[failure-regression-summary] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exitCode = 1;
});
