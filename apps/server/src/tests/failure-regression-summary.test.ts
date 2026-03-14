import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { summarizeFailureRegression } from "../../../../scripts/summarize-failure-regression-lib.mjs";

describe("scripts/summarize-failure-regression", () => {
  it("renders structured log coverage and writes aggregate artifact", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "failure-regression-summary-"));
    const reportPath = path.join(tempDir, "vitest-results.json");
    const outputPath = path.join(tempDir, "summary.md");
    const captureDir = path.join(tempDir, "structured-log-captures");

    try {
      await fs.mkdir(captureDir, { recursive: true });
      await fs.writeFile(
        reportPath,
        JSON.stringify({
          success: true,
          startTime: 1000,
          numTotalTests: 4,
          numPassedTests: 4,
          numFailedTests: 0,
          numPendingTests: 0,
          numTotalTestSuites: 2,
          numPassedTestSuites: 2,
          numFailedTestSuites: 0,
          testResults: [
            {
              name: "startup.failure.test.ts",
              endTime: 1800,
              assertionResults: [],
            },
            {
              name: "windows-fallback-integration.test.ts",
              endTime: 2400,
              assertionResults: [],
            },
          ],
        }),
        "utf-8"
      );

      await fs.writeFile(
        path.join(captureDir, "startup-restart-fallback.log"),
        [
          '[startup/failure] {"context":"startup","kind":"ptyUnavailable","code":"node_pty_unavailable","error":"node-pty not available","inputMode":"pty","fallback":{"attempted":true,"activated":true,"reason":"activated"},"target":{"cmd":"codex","cwd":"/tmp/project"}}',
          '[startup/failure] {"context":"restart","kind":"ptyUnavailable","code":"node_pty_unavailable","error":"node-pty not available","inputMode":"pty","fallback":{"attempted":true,"activated":false,"reason":"file_not_found"},"target":{"cmd":"codex","cwd":"/tmp/project","inputFile":"/tmp/missing.log"}}',
          '[server/state-event] {"ts":1,"trigger":"file_tail_started","from":"starting","to":"file_running","inputMode":"file","profileId":null,"detail":"fallback_reason=activated","context":{"inputFile":"/tmp/input.log"}}',
          '[server/state-event] {"ts":2,"trigger":"restart_failed","from":"restarting","to":"failed","inputMode":"pty","profileId":"profile-1","detail":"fallback_reason=file_not_found","context":{"fallbackReason":"file_not_found"}}',
        ].join("\n"),
        "utf-8"
      );

      await summarizeFailureRegression({ reportPath, outputPath, captureDir });

      const markdown = await fs.readFile(outputPath, "utf-8");
      expect(markdown).toContain("## Failure Regression Summary");
      expect(markdown).toContain("### Structured Log Coverage");
      expect(markdown).toContain("`node_pty_unavailable` x2");
      expect(markdown).toContain("`activated` x1");
      expect(markdown).toContain("`file_not_found` x1");
      expect(markdown).toContain("`file_tail_started` x1");
      expect(markdown).toContain("`restart_failed` x1");
      expect(markdown).toContain("`startup-restart-fallback`");

      const structuredSummary = JSON.parse(
        await fs.readFile(path.join(tempDir, "structured-log-summary.json"), "utf-8")
      );
      expect(structuredSummary).toMatchObject({
        found: true,
        scenarioCount: 1,
        startupFailureCount: 2,
        serverStateEventCount: 2,
      });
      expect(structuredSummary.startupFailureCodes).toEqual([{ value: "node_pty_unavailable", count: 2 }]);
      expect(structuredSummary.fallbackReasons).toEqual([
        { value: "activated", count: 1 },
        { value: "file_not_found", count: 1 },
      ]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
