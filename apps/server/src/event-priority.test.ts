import { describe, expect, it } from "vitest";
import { createCommentaryGate, getEventPriority, withEventPriority } from "./event-priority.js";

describe("event priority", () => {
  it("classifies supervision events", () => {
    expect(getEventPriority({ ts: 1, type: "stdout", summary: "許可を待っている" })).toBe("urgent");
    expect(getEventPriority({ ts: 1, type: "stdout", summary: "質問への回答を待っている" })).toBe("urgent");
    expect(getEventPriority({ ts: 1, type: "error", summary: "失敗" })).toBe("urgent");
    expect(getEventPriority({ ts: 1, type: "done", summary: "完了" })).toBe("notice");
    expect(getEventPriority({ ts: 1, type: "stdout", summary: "長考・沈黙が続いている" })).toBe("notice");
    expect(getEventPriority({ ts: 1, type: "read", summary: "読取" })).toBe("progress");
  });

  it("preserves an explicit priority", () => {
    expect(
      withEventPriority({ ts: 1, type: "stdout", summary: "custom", priority: "notice" })
    ).toMatchObject({ priority: "notice" });
  });

  it("throttles only progress commentary", () => {
    let current = 0;
    const gate = createCommentaryGate({ intervalMs: 2000, now: () => current });

    expect(gate.shouldEmit("progress")).toBe(true);
    current = 1000;
    expect(gate.shouldEmit("progress")).toBe(false);
    expect(gate.shouldEmit("urgent")).toBe(true);
    expect(gate.shouldEmit("notice")).toBe(true);
    current = 1999;
    expect(gate.shouldEmit("progress")).toBe(false);
    current = 2000;
    expect(gate.shouldEmit("progress")).toBe(true);
  });
});
