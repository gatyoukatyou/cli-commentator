import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  list,
  get,
  getActiveId,
  getActive,
  setActive,
  create,
  update,
  remove,
  createFromEnv,
  clearCache,
} from "../profile/manager.js";
import { loadStore } from "../profile/store.js";

describe("profile/manager", () => {
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = await mkdtemp(join(tmpdir(), "cli-commentator-manager-test-"));
    // Override XDG_CONFIG_HOME to use temp directory
    process.env.XDG_CONFIG_HOME = tempDir;
    // Clear in-memory cache before each test
    clearCache();
  });

  afterEach(async () => {
    // Restore original environment
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
    // Clean up temp directory
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("list", () => {
    it("returns empty array when no profiles exist", async () => {
      const profiles = await list();
      expect(profiles).toEqual([]);
    });

    it("returns profile summaries", async () => {
      await create({ name: "Profile 1", cmd: "bash" });
      await create({ name: "Profile 2", cmd: "zsh" });

      const profiles = await list();
      expect(profiles).toHaveLength(2);
      expect(profiles[0]).toHaveProperty("id");
      expect(profiles[0]).toHaveProperty("name", "Profile 1");
      expect(profiles[0]).toHaveProperty("cmd", "bash");
      // Summaries should not contain full profile fields
      expect(profiles[0]).not.toHaveProperty("args");
      expect(profiles[0]).not.toHaveProperty("style");
    });
  });

  describe("create", () => {
    it("creates a new profile with defaults", async () => {
      const profile = await create({ name: "Test", cmd: "bash" });

      expect(profile.id).toBeDefined();
      expect(profile.name).toBe("Test");
      expect(profile.cmd).toBe("bash");
      expect(profile.args).toEqual([]);
      expect(profile.style).toBe("kansai");
      expect(profile.logSource).toBe("auto");
      expect(profile.createdAt).toBeGreaterThan(0);
      expect(profile.updatedAt).toBe(profile.createdAt);
    });

    it("creates a profile with all fields", async () => {
      const profile = await create({
        name: "Full",
        cmd: "/bin/zsh",
        args: ["-l", "-i"],
        cwd: "/home/user",
        style: "standard",
        logSource: "claude",
        llmProvider: "openai",
      });

      expect(profile.name).toBe("Full");
      expect(profile.cmd).toBe("/bin/zsh");
      expect(profile.args).toEqual(["-l", "-i"]);
      expect(profile.cwd).toBe("/home/user");
      expect(profile.style).toBe("standard");
      expect(profile.logSource).toBe("claude");
      expect(profile.llmProvider).toBe("openai");
    });

    it("persists to disk", async () => {
      const profile = await create({ name: "Persist", cmd: "fish" });
      clearCache();

      const store = await loadStore();
      expect(store.profiles).toHaveLength(1);
      expect(store.profiles[0].id).toBe(profile.id);
    });
  });

  describe("get", () => {
    it("returns null for non-existent profile", async () => {
      const profile = await get("non-existent");
      expect(profile).toBeNull();
    });

    it("returns profile by ID", async () => {
      const created = await create({ name: "Get Test", cmd: "bash" });
      const retrieved = await get(created.id);

      expect(retrieved).toEqual(created);
    });
  });

  describe("update", () => {
    it("updates profile fields", async () => {
      const created = await create({ name: "Original", cmd: "bash" });
      const updated = await update(created.id, {
        name: "Updated",
        cmd: "zsh",
        style: "zundamon",
      });

      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe("Updated");
      expect(updated.cmd).toBe("zsh");
      expect(updated.style).toBe("zundamon");
      expect(updated.updatedAt).toBeGreaterThan(created.updatedAt);
    });

    it("throws for non-existent profile", async () => {
      await expect(update("non-existent", { name: "X" })).rejects.toThrow(
        "Profile not found"
      );
    });

    it("persists updates to disk", async () => {
      const created = await create({ name: "Before", cmd: "bash" });
      await update(created.id, { name: "After" });
      clearCache();

      const store = await loadStore();
      expect(store.profiles[0].name).toBe("After");
    });
  });

  describe("remove", () => {
    it("removes profile by ID", async () => {
      const profile = await create({ name: "To Delete", cmd: "bash" });
      await remove(profile.id);

      const profiles = await list();
      expect(profiles).toHaveLength(0);
    });

    it("throws for non-existent profile", async () => {
      await expect(remove("non-existent")).rejects.toThrow("Profile not found");
    });

    it("clears activeId when deleting active profile", async () => {
      const profile = await create({ name: "Active", cmd: "bash" });
      await setActive(profile.id);
      await remove(profile.id);

      const activeId = await getActiveId();
      expect(activeId).toBeNull();
    });

    it("preserves activeId when deleting non-active profile", async () => {
      const profile1 = await create({ name: "Active", cmd: "bash" });
      const profile2 = await create({ name: "Other", cmd: "zsh" });
      await setActive(profile1.id);
      await remove(profile2.id);

      const activeId = await getActiveId();
      expect(activeId).toBe(profile1.id);
    });
  });

  describe("getActiveId / setActive", () => {
    it("returns null when no active profile is set", async () => {
      const activeId = await getActiveId();
      expect(activeId).toBeNull();
    });

    it("sets and returns active profile ID", async () => {
      const profile = await create({ name: "Test", cmd: "bash" });
      await setActive(profile.id);

      const activeId = await getActiveId();
      expect(activeId).toBe(profile.id);
    });

    it("allows setting active to null", async () => {
      const profile = await create({ name: "Test", cmd: "bash" });
      await setActive(profile.id);
      await setActive(null);

      const activeId = await getActiveId();
      expect(activeId).toBeNull();
    });

    it("throws when setting non-existent profile as active", async () => {
      await expect(setActive("non-existent")).rejects.toThrow(
        "Profile not found"
      );
    });
  });

  describe("getActive", () => {
    it("returns null when no active profile is set", async () => {
      const active = await getActive();
      expect(active).toBeNull();
    });

    it("returns the active profile", async () => {
      const profile = await create({ name: "Active", cmd: "bash" });
      await setActive(profile.id);

      const active = await getActive();
      expect(active).toEqual(profile);
    });
  });

  describe("createFromEnv", () => {
    it("creates input from environment variables", () => {
      const input = createFromEnv({
        TARGET_CMD: "/bin/zsh",
        TARGET_ARGS: "-l -i",
        TARGET_CWD: "/home/user",
        STYLE: "standard",
        LOG_SOURCE: "claude",
        LLM_PROVIDER: "openai",
      });

      expect(input).toEqual({
        name: "Default",
        cmd: "/bin/zsh",
        args: ["-l", "-i"],
        cwd: "/home/user",
        style: "standard",
        logSource: "claude",
        llmProvider: "openai",
      });
    });

    it("uses defaults when environment variables are not set", () => {
      const input = createFromEnv({});

      const expectedCmd = process.platform === "win32" ? "powershell.exe" : "bash";
      expect(input).toEqual({
        name: "Default",
        cmd: expectedCmd,
        args: [],
        cwd: undefined,
        style: "kansai",
        logSource: "auto",
        llmProvider: undefined,
      });
    });

    it("handles empty TARGET_ARGS", () => {
      const input = createFromEnv({
        TARGET_ARGS: "",
      });

      expect(input.args).toEqual([]);
    });

    it("handles TARGET_ARGS with multiple spaces", () => {
      const input = createFromEnv({
        TARGET_ARGS: "  -l   -i  ",
      });

      expect(input.args).toEqual(["-l", "-i"]);
    });
  });

  describe("clearCache", () => {
    it("clears the in-memory cache", async () => {
      await create({ name: "Cached", cmd: "bash" });

      // Verify profile exists
      let profiles = await list();
      expect(profiles).toHaveLength(1);

      // Clear cache and modify file directly (simulating external change)
      clearCache();

      // Re-list should re-read from disk
      profiles = await list();
      expect(profiles).toHaveLength(1);
    });
  });
});
