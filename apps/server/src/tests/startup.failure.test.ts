import { describe, expect, it } from "vitest";
import {
  buildPtyStartupFailureLog,
  classifyPtyStartupFailureCode,
  formatPtyStartupFailureLog,
  type FileFallbackResult,
} from "../pty/startup-failure.js";
import type { PtyFailure } from "../pty/unavailable.js";

const NO_FALLBACK: FileFallbackResult = {
  attempted: false,
  activated: false,
  reason: "not_attempted",
};

describe("pty/startup-failure", () => {
  describe("classifyPtyStartupFailureCode", () => {
    it("classifies ptyUnavailable as node_pty_unavailable", () => {
      const failure: PtyFailure = {
        kind: "ptyUnavailable",
        error: "node-pty not available: missing binary",
      };
      expect(classifyPtyStartupFailureCode(failure)).toBe("node_pty_unavailable");
    });

    it("classifies command ENOENT as target_command_not_found", () => {
      const failure: PtyFailure = {
        kind: "ptyError",
        error: "spawn codex ENOENT",
      };
      expect(classifyPtyStartupFailureCode(failure)).toBe("target_command_not_found");
    });

    it("classifies cwd ENOENT as target_cwd_not_found", () => {
      const failure: PtyFailure = {
        kind: "ptyError",
        error: "spawn bash ENOENT cwd=/tmp/missing",
      };
      expect(classifyPtyStartupFailureCode(failure)).toBe("target_cwd_not_found");
    });

    it("classifies EACCES as target_permission_denied", () => {
      const failure: PtyFailure = {
        kind: "ptyError",
        error: "spawn /bin/bash EACCES",
      };
      expect(classifyPtyStartupFailureCode(failure)).toBe("target_permission_denied");
    });

    it("classifies invalid TARGET_ARGS_JSON errors", () => {
      const failure: PtyFailure = {
        kind: "ptyError",
        error: "Invalid TARGET_ARGS_JSON (must be JSON array of strings)",
      };
      expect(classifyPtyStartupFailureCode(failure)).toBe("invalid_target_args_json");
    });

    it("falls back to unknown for non-matching errors", () => {
      const failure: PtyFailure = {
        kind: "ptyError",
        error: "unexpected launch failure",
      };
      expect(classifyPtyStartupFailureCode(failure)).toBe("unknown");
    });
  });

  it("builds and formats structured startup failure logs", () => {
    const failure: PtyFailure = {
      kind: "ptyError",
      error: "spawn bash ENOENT",
    };
    const payload = buildPtyStartupFailureLog({
      context: "startup",
      failure,
      inputMode: "pty",
      fallback: NO_FALLBACK,
    });

    expect(payload).toEqual({
      context: "startup",
      kind: "ptyError",
      code: "target_command_not_found",
      error: "spawn bash ENOENT",
      inputMode: "pty",
      fallback: NO_FALLBACK,
    });

    const line = formatPtyStartupFailureLog(payload);
    expect(line.startsWith("[startup/failure] ")).toBe(true);
    const parsed = JSON.parse(line.replace("[startup/failure] ", ""));
    expect(parsed).toEqual(payload);
  });
});
