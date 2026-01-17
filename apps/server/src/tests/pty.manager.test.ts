import { describe, it, expect } from "vitest";
import { configFromProfile, configFromEnv } from "../pty/manager.js";
import type { Profile } from "../profile/types.js";

describe("pty/manager", () => {
  describe("configFromProfile", () => {
    it("extracts PTY config from profile", () => {
      const profile: Profile = {
        id: "test-id",
        name: "Test Profile",
        cmd: "/bin/zsh",
        args: ["-l", "-i"],
        cwd: "/home/user",
        style: "kansai",
        logSource: "auto",
        createdAt: 1000,
        updatedAt: 1000,
      };

      const config = configFromProfile(profile);

      expect(config.cmd).toBe("/bin/zsh");
      expect(config.args).toEqual(["-l", "-i"]);
      expect(config.cwd).toBe("/home/user");
    });

    it("uses process.cwd() when cwd is undefined", () => {
      const profile: Profile = {
        id: "test-id",
        name: "Test Profile",
        cmd: "bash",
        args: [],
        style: "standard",
        logSource: "claude",
        createdAt: 1000,
        updatedAt: 1000,
      };

      const config = configFromProfile(profile);

      expect(config.cmd).toBe("bash");
      expect(config.args).toEqual([]);
      expect(config.cwd).toBe(process.cwd());
    });

    it("preserves empty args array", () => {
      const profile: Profile = {
        id: "test-id",
        name: "Minimal",
        cmd: "fish",
        args: [],
        style: "zundamon",
        logSource: "generic",
        createdAt: 1000,
        updatedAt: 1000,
      };

      const config = configFromProfile(profile);

      expect(config.args).toEqual([]);
    });
  });

  describe("configFromEnv", () => {
    it("extracts PTY config from environment variables", () => {
      const config = configFromEnv({
        TARGET_CMD: "fish",
        TARGET_ARGS: "-c test",
        TARGET_CWD: "/tmp",
      });

      expect(config.cmd).toBe("fish");
      expect(config.args).toEqual(["-c", "test"]);
      expect(config.cwd).toBe("/tmp");
    });

    it("uses defaults when env vars not set", () => {
      const config = configFromEnv({});

      const expectedCmd = process.platform === "win32" ? "powershell.exe" : "bash";
      expect(config.cmd).toBe(expectedCmd);
      expect(config.args).toEqual([]);
      expect(config.cwd).toBe(process.cwd());
    });

    it("handles empty TARGET_ARGS", () => {
      const config = configFromEnv({
        TARGET_CMD: "zsh",
        TARGET_ARGS: "",
      });

      expect(config.cmd).toBe("zsh");
      expect(config.args).toEqual([]);
    });

    it("handles TARGET_ARGS with multiple spaces", () => {
      const config = configFromEnv({
        TARGET_ARGS: "  -l   -i  ",
      });

      expect(config.args).toEqual(["-l", "-i"]);
    });

    it("handles TARGET_ARGS with single argument", () => {
      const config = configFromEnv({
        TARGET_ARGS: "-l",
      });

      expect(config.args).toEqual(["-l"]);
    });

    it("uses process.cwd() when TARGET_CWD not set", () => {
      const config = configFromEnv({
        TARGET_CMD: "bash",
      });

      expect(config.cwd).toBe(process.cwd());
    });

    it("uses default process.env when no argument provided", () => {
      // This tests that the function can be called without arguments
      // We can't fully test this without mocking process.env, but we can verify it doesn't throw
      const config = configFromEnv();
      expect(config).toBeDefined();
      expect(typeof config.cmd).toBe("string");
      expect(Array.isArray(config.args)).toBe(true);
      expect(typeof config.cwd).toBe("string");
    });
  });
});
