import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SILENCE_TIMEOUT_MS,
  createSilenceTimer,
  parseSilenceTimeoutMs,
} from "./silence-timer.js";

describe("silence timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a positive env threshold and falls back for invalid values", () => {
    expect(parseSilenceTimeoutMs("2500")).toBe(2500);
    expect(parseSilenceTimeoutMs("0")).toBe(DEFAULT_SILENCE_TIMEOUT_MS);
    expect(parseSilenceTimeoutMs("invalid")).toBe(DEFAULT_SILENCE_TIMEOUT_MS);
  });

  it("fires after the configured interval without output", () => {
    const onSilence = vi.fn();
    const timer = createSilenceTimer({ thresholdMs: 1000, onSilence });

    timer.start();
    vi.advanceTimersByTime(999);
    expect(onSilence).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onSilence).toHaveBeenCalledTimes(1);
  });

  it("resets the interval when output resumes", () => {
    const onSilence = vi.fn();
    const timer = createSilenceTimer({ thresholdMs: 1000, onSilence });

    timer.start();
    vi.advanceTimersByTime(800);
    timer.activity();
    vi.advanceTimersByTime(800);
    expect(onSilence).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(onSilence).toHaveBeenCalledTimes(1);
  });

  it("does not repeat until new output activity and stops with the input source", () => {
    const onSilence = vi.fn();
    const timer = createSilenceTimer({ thresholdMs: 1000, onSilence });

    timer.start();
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(5000);
    expect(onSilence).toHaveBeenCalledTimes(1);

    timer.activity();
    vi.advanceTimersByTime(1000);
    expect(onSilence).toHaveBeenCalledTimes(2);

    timer.activity();
    timer.stop();
    vi.advanceTimersByTime(1000);
    expect(onSilence).toHaveBeenCalledTimes(2);
  });
});
