import { describe, expect, it } from "vitest";
import {
  classifyPtyFailure,
  createPtyUnavailableMessage,
  getErrorMessage,
  PTY_UNAVAILABLE_SUGGESTION,
} from "../pty/unavailable.js";

describe("pty/unavailable", () => {
  describe("getErrorMessage", () => {
    it("extracts message from Error instance", () => {
      expect(getErrorMessage(new Error("boom"))).toBe("boom");
    });

    it("stringifies unknown values", () => {
      expect(getErrorMessage("plain-error")).toBe("plain-error");
      expect(getErrorMessage(42)).toBe("42");
    });
  });

  describe("classifyPtyFailure", () => {
    it("classifies as ptyUnavailable when getNodePtyError value exists", () => {
      const result = classifyPtyFailure(new Error("other failure"), "node-pty not available: missing binary");
      expect(result).toEqual({
        kind: "ptyUnavailable",
        error: "node-pty not available: missing binary",
      });
    });

    it("classifies as ptyUnavailable when error message includes node-pty sentinel", () => {
      const result = classifyPtyFailure(new Error("node-pty not available: ABI mismatch"), null);
      expect(result).toEqual({
        kind: "ptyUnavailable",
        error: "node-pty not available: ABI mismatch",
      });
    });

    it("classifies as ptyError for non node-pty failures", () => {
      const result = classifyPtyFailure(new Error("spawn ENOENT"), null);
      expect(result).toEqual({
        kind: "ptyError",
        error: "spawn ENOENT",
      });
    });
  });

  describe("createPtyUnavailableMessage", () => {
    it("builds ptyUnavailable payload with default suggestion", () => {
      expect(createPtyUnavailableMessage("node-pty missing")).toEqual({
        kind: "ptyUnavailable",
        error: "node-pty missing",
        suggestion: PTY_UNAVAILABLE_SUGGESTION,
      });
    });

    it("accepts custom suggestion", () => {
      expect(createPtyUnavailableMessage("node-pty missing", "custom suggestion")).toEqual({
        kind: "ptyUnavailable",
        error: "node-pty missing",
        suggestion: "custom suggestion",
      });
    });
  });
});
