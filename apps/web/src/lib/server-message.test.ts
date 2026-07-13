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
        priority: "urgent",
      },
      narration: "処理中です。",
      glossaryNotes: ["補足"],
    });

    expect(message).toMatchObject({
      kind: "commentary",
      ts: 123,
      narration: "処理中です。",
      ev: { type: "stdout", summary: "ログ更新", priority: "urgent" },
    });
  });

  it("accepts priority on event messages and legacy events without it", () => {
    expect(
      parseServerMessage({
        kind: "event",
        ev: { ts: 456, type: "done", summary: "完了", priority: "notice" },
      })
    ).toMatchObject({
      kind: "event",
      ev: { priority: "notice" },
    });

    expect(
      parseServerMessage({
        kind: "event",
        ev: { ts: 789, type: "stdout", summary: "legacy" },
      })
    ).toMatchObject({
      kind: "event",
      ev: { summary: "legacy" },
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
    expect(
      parseServerMessage({
        kind: "event",
        ev: { ts: 123, type: "stdout", summary: "bad", priority: "immediate" },
      })
    ).toBeNull();
    expect(parseServerMessage("not an object")).toBeNull();
  });
});
