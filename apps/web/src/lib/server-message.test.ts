import { describe, expect, it } from "vitest";
import { parseServerMessage } from "@cli-commentator/shared";

describe("parseServerMessage", () => {
  it("parses canonical commentary messages", () => {
    const message = parseServerMessage({
      kind: "commentary",
      ts: 123,
      ev: {
        ts: 123,
        type: "stdout",
        summary: "ログ更新",
        detail: "done",
      },
      narration: "処理中です。",
      glossaryNotes: ["補足"],
    });

    expect(message).toMatchObject({
      kind: "commentary",
      ts: 123,
      narration: "処理中です。",
      ev: { type: "stdout", summary: "ログ更新" },
    });
  });

  it("normalizes legacy type/payload envelopes", () => {
    expect(
      parseServerMessage({
        type: "ptyUnavailable",
        payload: {
          error: "PTY unavailable",
          suggestion: "INPUT_MODE=file",
        },
      })
    ).toEqual({
      kind: "ptyUnavailable",
      error: "PTY unavailable",
      suggestion: "INPUT_MODE=file",
    });
  });

  it("rejects malformed messages", () => {
    expect(parseServerMessage({ kind: "style", style: "unknown" })).toBeNull();
    expect(parseServerMessage({ kind: "commentary", ts: 123 })).toBeNull();
    expect(parseServerMessage("not an object")).toBeNull();
  });
});
