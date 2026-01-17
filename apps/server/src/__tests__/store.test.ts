import { describe, expect, it } from "vitest";
import path from "node:path";
import { getConfigDir } from "../profile/store.js";

describe("getConfigDir", () => {
  describe("Windows", () => {
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

  describe("Unix (Linux/macOS)", () => {
    it("uses XDG_CONFIG_HOME when available", () => {
      const result = getConfigDir({
        platform: "linux",
        env: { XDG_CONFIG_HOME: "/custom/config", HOME: "/home/user" },
      });
      expect(result).toBe(
        path.posix.join("/custom/config", "cli-commentator")
      );
    });

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

    it("XDG_CONFIG_HOME takes precedence over HOME", () => {
      const result = getConfigDir({
        platform: "linux",
        env: {
          XDG_CONFIG_HOME: "/xdg/config",
          HOME: "/home/user",
        },
      });
      expect(result).toBe(
        path.posix.join("/xdg/config", "cli-commentator")
      );
    });
  });
});
