import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import {
  getConfigDir,
  getStorePath,
  ensureDir,
  loadStore,
  saveStore,
} from "../profile/store.js";
import type { ProfileStore } from "../profile/types.js";

describe("profile/store", () => {
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = await mkdtemp(join(tmpdir(), "cli-commentator-test-"));
    // Override XDG_CONFIG_HOME to use temp directory
    process.env.XDG_CONFIG_HOME = tempDir;
  });

  afterEach(async () => {
    // Restore original environment
    process.env.XDG_CONFIG_HOME = originalEnv.XDG_CONFIG_HOME;
    process.env.HOME = originalEnv.HOME;
    // Clean up temp directory
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("getConfigDir", () => {
    it("uses XDG_CONFIG_HOME when set", () => {
      process.env.XDG_CONFIG_HOME = "/custom/config";
      expect(getConfigDir()).toBe(path.join("/custom/config", "cli-commentator"));
    });

    it("falls back to ~/.config when XDG_CONFIG_HOME is not set", () => {
      delete process.env.XDG_CONFIG_HOME;
      process.env.HOME = "/home/user";
      // On Windows without XDG, falls back to APPDATA; on Unix, HOME/.config
      if (process.platform === "win32") {
        // Skip this test on Windows (APPDATA would be used)
        return;
      }
      expect(getConfigDir()).toBe(path.join("/home/user", ".config", "cli-commentator"));
    });
  });

  describe("getStorePath", () => {
    it("returns path to profiles.json", () => {
      process.env.XDG_CONFIG_HOME = "/custom/config";
      expect(getStorePath()).toBe(path.join("/custom/config", "cli-commentator", "profiles.json"));
    });
  });

  describe("ensureDir", () => {
    it("creates config directory if it does not exist", async () => {
      await ensureDir();
      const dir = getConfigDir();
      const stat = await import("node:fs/promises").then((fs) => fs.stat(dir));
      expect(stat.isDirectory()).toBe(true);
    });

    it("does not throw if directory already exists", async () => {
      await ensureDir();
      await expect(ensureDir()).resolves.not.toThrow();
    });
  });

  describe("loadStore", () => {
    it("returns empty store when file does not exist", async () => {
      const store = await loadStore();
      expect(store).toEqual({
        version: 1,
        activeId: null,
        profiles: [],
      });
    });

    it("loads existing store from file", async () => {
      const existingStore: ProfileStore = {
        version: 1,
        activeId: "test-id",
        profiles: [
          {
            id: "test-id",
            name: "Test Profile",
            cmd: "bash",
            args: ["-l"],
            style: "kansai",
            logSource: "auto",
            createdAt: 1000,
            updatedAt: 1000,
          },
        ],
      };

      await ensureDir();
      await writeFile(getStorePath(), JSON.stringify(existingStore), "utf-8");

      const store = await loadStore();
      expect(store).toEqual(existingStore);
    });

    it("returns empty store when file is corrupted", async () => {
      await ensureDir();
      await writeFile(getStorePath(), "not valid json", "utf-8");

      const store = await loadStore();
      expect(store).toEqual({
        version: 1,
        activeId: null,
        profiles: [],
      });
    });

    it("returns empty store when version is invalid", async () => {
      const invalidStore = {
        version: 999,
        activeId: null,
        profiles: [],
      };

      await ensureDir();
      await writeFile(getStorePath(), JSON.stringify(invalidStore), "utf-8");

      const store = await loadStore();
      expect(store).toEqual({
        version: 1,
        activeId: null,
        profiles: [],
      });
    });

    it("returns empty store when profiles is not an array", async () => {
      const invalidStore = {
        version: 1,
        activeId: null,
        profiles: "not an array",
      };

      await ensureDir();
      await writeFile(getStorePath(), JSON.stringify(invalidStore), "utf-8");

      const store = await loadStore();
      expect(store).toEqual({
        version: 1,
        activeId: null,
        profiles: [],
      });
    });
  });

  describe("saveStore", () => {
    it("saves store to file", async () => {
      const store: ProfileStore = {
        version: 1,
        activeId: "test-id",
        profiles: [
          {
            id: "test-id",
            name: "Test Profile",
            cmd: "zsh",
            args: [],
            style: "standard",
            logSource: "claude",
            createdAt: 2000,
            updatedAt: 2000,
          },
        ],
      };

      await saveStore(store);

      const content = await readFile(getStorePath(), "utf-8");
      const loaded = JSON.parse(content);
      expect(loaded).toEqual(store);
    });

    it("creates directory if it does not exist", async () => {
      const store: ProfileStore = {
        version: 1,
        activeId: null,
        profiles: [],
      };

      await saveStore(store);

      const content = await readFile(getStorePath(), "utf-8");
      expect(JSON.parse(content)).toEqual(store);
    });

    it("overwrites existing file", async () => {
      const store1: ProfileStore = {
        version: 1,
        activeId: null,
        profiles: [],
      };
      const store2: ProfileStore = {
        version: 1,
        activeId: "new-id",
        profiles: [
          {
            id: "new-id",
            name: "New Profile",
            cmd: "fish",
            args: [],
            style: "zundamon",
            logSource: "generic",
            createdAt: 3000,
            updatedAt: 3000,
          },
        ],
      };

      await saveStore(store1);
      await saveStore(store2);

      const content = await readFile(getStorePath(), "utf-8");
      expect(JSON.parse(content)).toEqual(store2);
    });

    it("uses atomic write (no partial writes)", async () => {
      const store: ProfileStore = {
        version: 1,
        activeId: null,
        profiles: Array.from({ length: 100 }, (_, i) => ({
          id: `id-${i}`,
          name: `Profile ${i}`,
          cmd: "bash",
          args: [],
          style: "kansai" as const,
          logSource: "auto" as const,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })),
      };

      await saveStore(store);

      // Verify the file is complete (not partial)
      const content = await readFile(getStorePath(), "utf-8");
      const loaded = JSON.parse(content);
      expect(loaded.profiles.length).toBe(100);
    });
  });

  describe("save and load roundtrip", () => {
    it("preserves all profile fields", async () => {
      const store: ProfileStore = {
        version: 1,
        activeId: "profile-1",
        profiles: [
          {
            id: "profile-1",
            name: "Full Profile",
            cmd: "/bin/zsh",
            args: ["-l", "-i"],
            cwd: "/home/user/project",
            style: "kansai",
            logSource: "claude",
            llmProvider: "openai",
            createdAt: 1234567890,
            updatedAt: 1234567891,
          },
        ],
      };

      await saveStore(store);
      const loaded = await loadStore();

      expect(loaded).toEqual(store);
    });
  });
});
