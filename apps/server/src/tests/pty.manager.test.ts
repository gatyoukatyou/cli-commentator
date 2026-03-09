import { afterEach, describe, expect, it, vi } from "vitest";
import { configFromProfile, configFromEnv, resolveUseConpty } from "../pty/manager.js";
import type { Profile } from "../profile/types.js";

describe("pty/manager", () => {
  afterEach(() => {
    vi.doUnmock("node:module");
    vi.resetModules();
  });

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

    it("trims profile command, args, and cwd", () => {
      const profile: Profile = {
        id: "test-id",
        name: "Whitespace",
        cmd: "  /bin/zsh  ",
        args: ["  -l", "-i  ", "   "],
        cwd: "  /tmp/test  ",
        style: "standard",
        logSource: "claude",
        createdAt: 1000,
        updatedAt: 1000,
      };

      const config = configFromProfile(profile);

      expect(config.cmd).toBe("/bin/zsh");
      expect(config.args).toEqual(["-l", "-i"]);
      expect(config.cwd).toBe("/tmp/test");
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

    it("trims environment command, args, and cwd", () => {
      const config = configFromEnv({
        TARGET_CMD: "  bash  ",
        TARGET_ARGS: "  -l   -i  ",
        TARGET_CWD: "  /tmp/demo  ",
      });

      expect(config.cmd).toBe("bash");
      expect(config.args).toEqual(["-l", "-i"]);
      expect(config.cwd).toBe("/tmp/demo");
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

  describe("resolveUseConpty", () => {
    it("returns false on non-Windows platforms", () => {
      expect(resolveUseConpty({ platform: "darwin", env: {}, execArgv: [] })).toBe(false);
      expect(resolveUseConpty({ platform: "linux", env: {}, execArgv: [] })).toBe(false);
    });

    it("respects explicit disable via PTY_USE_CONPTY", () => {
      expect(resolveUseConpty({ platform: "win32", env: { PTY_USE_CONPTY: "0" }, execArgv: [] })).toBe(false);
      expect(resolveUseConpty({ platform: "win32", env: { PTY_USE_CONPTY: "false" }, execArgv: [] })).toBe(false);
      expect(resolveUseConpty({ platform: "win32", env: { PTY_USE_CONPTY: "off" }, execArgv: [] })).toBe(false);
    });

    it("respects explicit enable via PTY_USE_CONPTY", () => {
      expect(resolveUseConpty({ platform: "win32", env: { PTY_USE_CONPTY: "1" }, execArgv: [] })).toBe(true);
      expect(resolveUseConpty({ platform: "win32", env: { PTY_USE_CONPTY: "true" }, execArgv: [] })).toBe(true);
      expect(resolveUseConpty({ platform: "win32", env: { PTY_USE_CONPTY: "on" }, execArgv: [] })).toBe(true);
    });

    it("disables ConPTY when debugger flags are present in execArgv", () => {
      expect(resolveUseConpty({ platform: "win32", env: {}, execArgv: ["--inspect=9229"] })).toBe(false);
      expect(resolveUseConpty({ platform: "win32", env: {}, execArgv: ["--inspect-brk"] })).toBe(false);
    });

    it("disables ConPTY when debugger flags are present in NODE_OPTIONS", () => {
      expect(
        resolveUseConpty({
          platform: "win32",
          env: { NODE_OPTIONS: "--inspect=0.0.0.0:9229" },
          execArgv: [],
        })
      ).toBe(false);
    });

    it("defaults to true on Windows when no override/debugger is present", () => {
      expect(resolveUseConpty({ platform: "win32", env: {}, execArgv: [] })).toBe(true);
    });
  });

  describe("createPTYManager", () => {
    it("surfaces node-pty spawn failures unchanged", async () => {
      vi.resetModules();
      const spawnError = new Error("spawn bash ENOENT");
      const spawn = vi.fn(() => {
        throw spawnError;
      });

      vi.doMock("node:module", () => ({
        createRequire: () => {
          return (specifier: string) => {
            if (specifier === "node-pty") {
              return { spawn };
            }
            throw new Error(`unexpected require: ${specifier}`);
          };
        },
      }));

      const { createPTYManager } = await import("../pty/manager.js");
      const manager = createPTYManager();

      expect(() =>
        manager.spawn({
          cmd: "bash",
          args: ["-lc", "pwd"],
          cwd: process.cwd(),
        })
      ).toThrow(spawnError);

      expect(spawn).toHaveBeenCalledWith(
        "bash",
        ["-lc", "pwd"],
        expect.objectContaining({
          name: "xterm-256color",
          cols: 120,
          rows: 30,
          cwd: process.cwd(),
          env: expect.any(Object),
        })
      );
    });
  });
});
