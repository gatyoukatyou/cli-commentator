import { describe, expect, it } from "vitest";
import {
  getDistanceToLogBottom,
  getLatestLogScrollTop,
  isAtLogLatest,
  LOG_AUTO_SCROLL_THRESHOLD_PX,
} from "./log-scroll";

describe("commentary log scroll follow state", () => {
  it("treats the bottom as the latest position", () => {
    expect(isAtLogLatest({ scrollHeight: 1000, scrollTop: 800, clientHeight: 200 })).toBe(true);
    expect(getDistanceToLogBottom({ scrollHeight: 1000, scrollTop: 800, clientHeight: 200 })).toBe(0);
  });

  it("keeps following within the small bottom threshold", () => {
    expect(
      isAtLogLatest({ scrollHeight: 1000, scrollTop: 800 - LOG_AUTO_SCROLL_THRESHOLD_PX + 1, clientHeight: 200 })
    ).toBe(true);
    expect(
      isAtLogLatest({ scrollHeight: 1000, scrollTop: 800 - LOG_AUTO_SCROLL_THRESHOLD_PX - 1, clientHeight: 200 })
    ).toBe(false);
  });

  it("does not treat a past position as latest", () => {
    expect(isAtLogLatest({ scrollHeight: 1000, scrollTop: 420, clientHeight: 200 })).toBe(false);
  });

  it("calculates the scroll position used by 最新へ戻る", () => {
    expect(getLatestLogScrollTop({ scrollHeight: 1000, scrollTop: 0, clientHeight: 200 })).toBe(800);
    expect(getLatestLogScrollTop({ scrollHeight: 120, scrollTop: 0, clientHeight: 200 })).toBe(0);
  });
});
