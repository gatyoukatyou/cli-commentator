#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  collectStructuredLogCaptureSummary,
  parseStructuredLogLines,
  summarizeFailureRegression,
} from "./summarize-failure-regression-lib.mjs";

export { collectStructuredLogCaptureSummary, parseStructuredLogLines, summarizeFailureRegression };

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
