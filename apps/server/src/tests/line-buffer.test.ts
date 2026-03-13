import { describe, expect, it } from "vitest";
import { consumeCompleteLines } from "../line-buffer.js";

describe("consumeCompleteLines", () => {
  it("buffers partial terminal input until Enter is pressed", () => {
    expect(consumeCompleteLines("", "c")).toEqual({
      completeChunk: "",
      pending: "c",
    });

    expect(consumeCompleteLines("c", "odex")).toEqual({
      completeChunk: "",
      pending: "codex",
    });

    expect(consumeCompleteLines("codex", "\n")).toEqual({
      completeChunk: "codex",
      pending: "",
    });
  });

  it("returns completed lines and keeps only the trailing fragment", () => {
    expect(consumeCompleteLines("", "first\nsecond\nthi")).toEqual({
      completeChunk: "first\nsecond",
      pending: "thi",
    });
  });

  it("normalizes crlf without leaking carriage returns", () => {
    expect(consumeCompleteLines("", "line 1\r\nline 2\r\n")).toEqual({
      completeChunk: "line 1\nline 2",
      pending: "",
    });
  });
});
