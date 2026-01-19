/**
 * Quality Test Scenarios for extractEvents
 *
 * These tests verify that extractEvents correctly identifies critical events
 * from representative CLI output scenarios.
 *
 * Design principles:
 * - Critical events (errors, tests, builds) must not be omitted
 * - Duplicate event firing should be prevented (noise suppression)
 * - Event sequencing must align with user expectations
 *
 * @see Issue #38
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractEvents } from "../extract.js";
import type { EventType } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scenariosDir = path.resolve(__dirname, "../../test/fixtures/scenarios");

describe("Quality Test Scenarios", () => {
  const originalEnv = process.env.LOG_SOURCE;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
    process.env.LOG_SOURCE = "generic";
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalEnv === undefined) delete process.env.LOG_SOURCE;
    else process.env.LOG_SOURCE = originalEnv;
  });

  /**
   * Helper to count events by type
   */
  function countByType(events: Array<{ type: EventType }>): Record<string, number> {
    return events.reduce(
      (acc, ev) => {
        acc[ev.type] = (acc[ev.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }

  /**
   * Helper to check if events contain specific type
   */
  function hasEventType(events: Array<{ type: EventType }>, type: EventType): boolean {
    return events.some((ev) => ev.type === type);
  }

  describe("Install Scenarios", () => {
    it("install-success: detects package installation", async () => {
      const content = await fs.readFile(path.join(scenariosDir, "install-success.log"), "utf8");
      const events = extractEvents(content);

      expect(hasEventType(events, "install")).toBe(true);
      // Should detect "Lockfile is up to date" or "packages" output
      const installEvents = events.filter((ev) => ev.type === "install");
      expect(installEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("install-add-package: detects new dependency addition", async () => {
      const content = await fs.readFile(path.join(scenariosDir, "install-add-package.log"), "utf8");
      const events = extractEvents(content);

      expect(hasEventType(events, "install")).toBe(true);
      // Should mention package added
      const installEvents = events.filter((ev) => ev.type === "install");
      expect(installEvents.some((ev) => ev.detail?.includes("lodash") || ev.summary.includes("パッケージ"))).toBe(true);
    });
  });

  describe("Dev Server Scenarios", () => {
    it("dev-server-start: detects server startup", async () => {
      const content = await fs.readFile(path.join(scenariosDir, "dev-server-start.log"), "utf8");
      const events = extractEvents(content);

      expect(hasEventType(events, "server")).toBe(true);
      // Should detect vite or localhost
      const serverEvents = events.filter((ev) => ev.type === "server");
      expect(serverEvents.some((ev) => ev.detail?.includes("vite") || ev.detail?.includes("localhost"))).toBe(true);
    });
  });

  describe("Test Scenarios", () => {
    it("test-success: detects passing tests without false errors", async () => {
      const content = await fs.readFile(path.join(scenariosDir, "test-success.log"), "utf8");
      const events = extractEvents(content);

      expect(hasEventType(events, "test")).toBe(true);
      // Success scenario should NOT have error events
      expect(hasEventType(events, "error")).toBe(false);
      // Should detect test results
      const testEvents = events.filter((ev) => ev.type === "test");
      expect(testEvents.some((ev) => ev.detail?.includes("passed") || ev.summary.includes("テスト"))).toBe(true);
    });

    it("test-failure: detects test failures as errors", async () => {
      const content = await fs.readFile(path.join(scenariosDir, "test-failure.log"), "utf8");
      const events = extractEvents(content);

      // Must detect test activity
      expect(hasEventType(events, "test")).toBe(true);
      // Must detect error (FAIL keyword)
      expect(hasEventType(events, "error")).toBe(true);
      // Error events should contain failure info
      const errorEvents = events.filter((ev) => ev.type === "error");
      expect(errorEvents.some((ev) => ev.detail?.includes("failed") || ev.detail?.includes("FAIL"))).toBe(true);
    });
  });

  describe("Build Scenarios", () => {
    it("build-success: detects successful build", async () => {
      const content = await fs.readFile(path.join(scenariosDir, "build-success.log"), "utf8");
      const events = extractEvents(content);

      expect(hasEventType(events, "build")).toBe(true);
      // Success scenario should NOT have error events
      expect(hasEventType(events, "error")).toBe(false);
      // Should detect build output
      const buildEvents = events.filter((ev) => ev.type === "build");
      expect(buildEvents.some((ev) => ev.detail?.includes("built") || ev.summary.includes("ビルド"))).toBe(true);
    });

    it("build-failure: detects TypeScript errors", async () => {
      const content = await fs.readFile(path.join(scenariosDir, "build-failure.log"), "utf8");
      const events = extractEvents(content);

      // Must detect error (TS errors)
      expect(hasEventType(events, "error")).toBe(true);
      // Error events should contain TypeScript error codes
      const errorEvents = events.filter((ev) => ev.type === "error");
      expect(errorEvents.some((ev) => ev.detail?.includes("TS") || ev.detail?.includes("error"))).toBe(true);
    });
  });

  describe("Git Scenarios", () => {
    it("git-operations: detects git commands and status", async () => {
      const content = await fs.readFile(path.join(scenariosDir, "git-operations.log"), "utf8");
      const events = extractEvents(content);

      expect(hasEventType(events, "git")).toBe(true);
      // Should detect multiple git operations
      const gitEvents = events.filter((ev) => ev.type === "git");
      expect(gitEvents.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Lint Scenarios", () => {
    it("lint-check: detects lint warnings and errors", async () => {
      const content = await fs.readFile(path.join(scenariosDir, "lint-check.log"), "utf8");
      const events = extractEvents(content);

      expect(hasEventType(events, "lint")).toBe(true);
      // Lint output may contain errors/warnings
      const lintEvents = events.filter((ev) => ev.type === "lint");
      expect(lintEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("GitHub Scenarios", () => {
    it("github-workflow: detects GitHub CLI operations", async () => {
      const content = await fs.readFile(path.join(scenariosDir, "github-workflow.log"), "utf8");
      const events = extractEvents(content);

      expect(hasEventType(events, "github")).toBe(true);
      // Should detect gh pr/workflow commands
      const ghEvents = events.filter((ev) => ev.type === "github");
      expect(ghEvents.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Quality Criteria", () => {
    it("critical events are never omitted in error scenarios", async () => {
      const errorScenarios = ["test-failure.log", "build-failure.log"];

      for (const scenario of errorScenarios) {
        const content = await fs.readFile(path.join(scenariosDir, scenario), "utf8");
        const events = extractEvents(content);

        // Error scenarios MUST have error type events
        expect(hasEventType(events, "error")).toBe(true);
      }
    });

    it("event counts are reasonable (no excessive noise)", async () => {
      const scenarios = [
        "install-success.log",
        "dev-server-start.log",
        "test-success.log",
        "build-success.log",
      ];

      for (const scenario of scenarios) {
        const content = await fs.readFile(path.join(scenariosDir, scenario), "utf8");
        const events = extractEvents(content);
        const lines = content.split("\n").filter((l) => l.trim()).length;

        // Events should not exceed line count (1 event per line max)
        expect(events.length).toBeLessThanOrEqual(lines);
        // But we should have at least some meaningful events
        expect(events.length).toBeGreaterThan(0);
      }
    });
  });
});
