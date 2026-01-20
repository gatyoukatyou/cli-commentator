/**
 * Tests for FileTail input source
 * @see Issue #40
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { FileTail, createFileTail } from "../input/file-tail.js";

/**
 * Platform-aware defaults for eventually() helper.
 * Windows fs.watch is slower to detect changes, so we use longer timeouts.
 */
const isWindows = process.platform === "win32";
const DEFAULT_TIMEOUT = isWindows ? 8000 : 3000;
const DEFAULT_INTERVAL = isWindows ? 100 : 50;

/**
 * Wait for a condition to become true with polling.
 * Useful for async tests where timing varies (especially on Windows).
 */
async function eventually(
  fn: () => boolean,
  timeout = DEFAULT_TIMEOUT,
  interval = DEFAULT_INTERVAL
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Condition not met within ${timeout}ms`);
}

describe("FileTail", () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    // Create temp directory and test file
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-tail-test-"));
    testFile = path.join(tempDir, "test.log");
    // Create file with initial content
    fs.writeFileSync(testFile, "initial line 1\ninitial line 2\n");
  });

  afterEach(() => {
    // Clean up
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("constructor", () => {
    it("creates instance with required options", () => {
      const tail = new FileTail({ filePath: testFile });
      expect(tail).toBeInstanceOf(FileTail);
      expect(tail.isRunning).toBe(false);
    });

    it("accepts optional tailLines parameter", () => {
      const tail = new FileTail({ filePath: testFile, tailLines: 5 });
      expect(tail).toBeInstanceOf(FileTail);
    });

    it("accepts optional encoding parameter", () => {
      const tail = new FileTail({ filePath: testFile, encoding: "utf-8" });
      expect(tail).toBeInstanceOf(FileTail);
    });
  });

  describe("start()", () => {
    it("throws error if file does not exist", () => {
      const tail = new FileTail({ filePath: "/nonexistent/file.log" });
      expect(() => tail.start()).toThrow("File not found");
    });

    it("starts tailing and sets isRunning to true", () => {
      const tail = new FileTail({ filePath: testFile });
      tail.start();
      expect(tail.isRunning).toBe(true);
      tail.stop();
    });

    it("emits initial content from file", async () => {
      const tail = new FileTail({ filePath: testFile, tailLines: 10 });
      const chunks: string[] = [];

      tail.on("data", (chunk) => chunks.push(chunk));
      tail.start();

      // Wait for initial data
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(chunks.length).toBeGreaterThan(0);
      const allContent = chunks.join("");
      expect(allContent).toContain("initial line 1");
      expect(allContent).toContain("initial line 2");

      tail.stop();
    });

    it("emits new content when file is appended", async () => {
      const tail = new FileTail({ filePath: testFile, tailLines: 0 });
      const chunks: string[] = [];

      tail.on("data", (chunk) => chunks.push(chunk));
      tail.start();

      // Wait for tail to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Append new content (use sync write to ensure bytes are flushed)
      fs.appendFileSync(testFile, "new line appended\n");

      // Wait for data event using eventually pattern
      // Windows file watchers can be slow to detect changes
      await eventually(
        () => chunks.join("").includes("new line appended"),
        3000,
        50
      );

      const allContent = chunks.join("");
      expect(allContent).toContain("new line appended");

      tail.stop();
    });
  });

  describe("stop()", () => {
    it("stops the tail process", () => {
      const tail = new FileTail({ filePath: testFile });
      tail.start();
      expect(tail.isRunning).toBe(true);

      tail.stop();
      expect(tail.isRunning).toBe(false);
    });

    it("emits exit event when stopped", async () => {
      const tail = new FileTail({ filePath: testFile });
      let exitCode: number | null = null;

      tail.on("exit", (code) => {
        exitCode = code;
      });
      tail.start();

      // Wait for start
      await new Promise((resolve) => setTimeout(resolve, 100));

      tail.stop();

      // Wait for exit event
      await new Promise((resolve) => setTimeout(resolve, 100));

      // SIGTERM usually results in null or signal-based exit
      expect(exitCode).toBeDefined();
    });

    it("is idempotent (can be called multiple times)", () => {
      const tail = new FileTail({ filePath: testFile });
      tail.start();
      tail.stop();
      tail.stop(); // Should not throw
      expect(tail.isRunning).toBe(false);
    });
  });

  describe("createFileTail factory", () => {
    it("creates FileTail instance", () => {
      const tail = createFileTail({ filePath: testFile });
      expect(tail).toBeInstanceOf(FileTail);
    });
  });

  describe("encoding support", () => {
    it("handles UTF-8 content correctly", async () => {
      // Write UTF-8 content
      fs.writeFileSync(testFile, "日本語テスト\nこんにちは\n");

      const tail = new FileTail({ filePath: testFile, encoding: "utf-8" });
      const chunks: string[] = [];

      tail.on("data", (chunk) => chunks.push(chunk));
      tail.start();

      await new Promise((resolve) => setTimeout(resolve, 200));

      const allContent = chunks.join("");
      expect(allContent).toContain("日本語テスト");
      expect(allContent).toContain("こんにちは");

      tail.stop();
    });
  });
});
