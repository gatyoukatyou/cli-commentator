import { describe, expect, it } from "vitest";
import type { Event } from "./types.js";
import { createRepeatedErrorDetector } from "./repeated-error-detector.js";

const errorEvent = (detail: string, ts = 1): Event => ({
  ts,
  type: "error",
  summary: "エラーが発生している",
  detail,
});

describe("repeated error detector", () => {
  it("promotes the third matching error to an urgent loop warning", () => {
    const detector = createRepeatedErrorDetector({ threshold: 3 });

    expect(detector.observe(errorEvent("Command failed with exit code 1"))).toMatchObject({
      summary: "エラーが発生している",
    });
    expect(detector.observe(errorEvent("  command FAILED with exit code 1  "))).toMatchObject({
      summary: "エラーが発生している",
    });
    expect(detector.observe(errorEvent("Command failed with exit code 1"))).toMatchObject({
      summary: "同じエラーが繰り返されている",
      detail: "3回検出: Command failed with exit code 1",
      priority: "urgent",
    });
  });

  it("does not combine different errors or ordinary progress events", () => {
    const detector = createRepeatedErrorDetector({ threshold: 3 });

    detector.observe(errorEvent("first failure"));
    detector.observe({ ts: 2, type: "search", summary: "原因を検索している" });
    detector.observe(errorEvent("second failure"));
    expect(detector.observe(errorEvent("first failure"))).toMatchObject({
      summary: "エラーが発生している",
    });
  });

  it("expires old repetitions and resets at session boundaries", () => {
    let current = 0;
    const detector = createRepeatedErrorDetector({ threshold: 3, windowMs: 1000, now: () => current });

    detector.observe(errorEvent("same failure"));
    current = 1001;
    detector.observe(errorEvent("same failure"));
    current = 1100;
    detector.observe({ ts: 3, type: "done", summary: "完了" });
    detector.observe(errorEvent("same failure"));
    expect(detector.observe(errorEvent("same failure"))).toMatchObject({
      summary: "エラーが発生している",
    });
  });

  it("emits only one loop warning until the error changes", () => {
    const detector = createRepeatedErrorDetector({ threshold: 3 });

    detector.observe(errorEvent("same failure"));
    detector.observe(errorEvent("same failure"));
    expect(detector.observe(errorEvent("same failure")).summary).toBe("同じエラーが繰り返されている");
    expect(detector.observe(errorEvent("same failure")).summary).toBe("エラーが発生している");
  });
});
