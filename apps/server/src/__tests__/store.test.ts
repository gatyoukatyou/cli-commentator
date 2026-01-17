import { describe, expect, it } from "vitest";
import path from "node:path";
import { getConfigDir } from "../profile/store.js";

describe("getConfigDir", () => {
  describe("XDG_CONFIG_HOME (all platforms)", () => {
    it("uses XDG_CONFIG_HOME when set (takes precedence)", () => {
      const result = getConfigDir({
        platform: "linux",
        env: { XDG_CONFIG_HOME: "/custom/config", HOME: "/home/user" },
      });
      // XDG uses path.join (current platform separator)
      expect(result).toBe(path.join("/custom/config", "cli-commentator"));
    });

    it("XDG_CONFIG_HOME works on Windows too (for test isolation)", () => {
      const result = getConfigDir({
        platform: "win32",
        env: {
          XDG_CONFIG_HOME: "/tmp/test-config",
          APPDATA: "C:\\Users\\x\\AppData\\Roaming",
        },
      });
      // XDG takes precedence even on Windows
      expect(result).toBe(path.join("/tmp/test-config", "cli-commentator"));
    });
  });

  describe("Windows (no XDG)", () => {
    it("uses APPDATA when available", () => {
      const result = getConfigDir({
        platform: "win32",
        env: { APPDATA: "C:\\Users\\x\\AppData\\Roaming" },
      });
      expect(result).toBe(
        path.win32.join("C:\\Users\\x\\AppData\\Roaming", "cli-commentator")
      );
    });

    it("derives from USERPROFILE when APPDATA is not set", () => {
      const result = getConfigDir({
        platform: "win32",
        env: { USERPROFILE: "C:\\Users\\x" },
      });
      expect(result).toBe(
        path.win32.join(
          "C:\\Users\\x",
          "AppData",
          "Roaming",
          "cli-commentator"
        )
      );
    });

    it("prefers APPDATA over USERPROFILE", () => {
      const result = getConfigDir({
        platform: "win32",
        env: {
          APPDATA: "D:\\Custom\\AppData",
          USERPROFILE: "C:\\Users\\x",
        },
      });
      expect(result).toBe(
        path.win32.join("D:\\Custom\\AppData", "cli-commentator")
      );
    });
  });

  describe("Unix (no XDG)", () => {
    it("falls back to HOME/.config when XDG_CONFIG_HOME is not set", () => {
      const result = getConfigDir({
        platform: "linux",
        env: { HOME: "/home/user" },
      });
      expect(result).toBe(
        path.posix.join("/home/user", ".config", "cli-commentator")
      );
    });

    it("works the same on darwin (macOS)", () => {
      const result = getConfigDir({
        platform: "darwin",
        env: { HOME: "/Users/dev" },
      });
      expect(result).toBe(
        path.posix.join("/Users/dev", ".config", "cli-commentator")
      );
    });
  });
});
