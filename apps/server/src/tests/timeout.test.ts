import { describe, it, expect, vi, afterEach } from "vitest";
import { withTimeout } from "../utils/timeout.js";

class TestError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "TestError";
  }
}

describe("withTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns result when promise resolves before timeout", async () => {
    const result = await withTimeout(
      Promise.resolve("success"),
      {
        ms: 1000,
        timeoutError: () => new TestError("timeout"),
      }
    );
    expect(result).toBe("success");
  });

  it("throws timeout error when promise takes too long", async () => {
    vi.useFakeTimers();

    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("slow"), 2000);
    });

    const promise = withTimeout(slowPromise, {
      ms: 100,
      timeoutError: () => new TestError("timeout"),
    });

    vi.advanceTimersByTime(100);

    await expect(promise).rejects.toThrow(TestError);
    await expect(promise).rejects.toMatchObject({ code: "timeout" });
  });

  it("calls onTimeout callback when timeout fires", async () => {
    vi.useFakeTimers();

    const onTimeout = vi.fn();
    const slowPromise = new Promise<string>(() => {});

    const promise = withTimeout(slowPromise, {
      ms: 100,
      timeoutError: () => new TestError("timeout"),
      onTimeout,
    });

    vi.advanceTimersByTime(100);

    await expect(promise).rejects.toThrow();
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("throws immediately if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      withTimeout(Promise.resolve("value"), {
        ms: 1000,
        timeoutError: () => new TestError("aborted"),
        signal: controller.signal,
      })
    ).rejects.toThrow(TestError);
  });

  it("throws when signal is aborted during execution", async () => {
    vi.useFakeTimers();

    const controller = new AbortController();
    const slowPromise = new Promise<string>(() => {});

    const promise = withTimeout(slowPromise, {
      ms: 1000,
      timeoutError: () => new TestError("aborted"),
      signal: controller.signal,
    });

    // Abort after 50ms
    setTimeout(() => controller.abort(), 50);
    vi.advanceTimersByTime(50);

    await expect(promise).rejects.toThrow(TestError);
    await expect(promise).rejects.toMatchObject({ code: "aborted" });
  });

  it("clears timeout when promise resolves", async () => {
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    await withTimeout(Promise.resolve("fast"), {
      ms: 1000,
      timeoutError: () => new TestError("timeout"),
    });

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it("removes abort listener on completion", async () => {
    const controller = new AbortController();
    const removeEventListenerSpy = vi.spyOn(controller.signal, "removeEventListener");

    await withTimeout(Promise.resolve("fast"), {
      ms: 1000,
      timeoutError: () => new TestError("timeout"),
      signal: controller.signal,
    });

    expect(removeEventListenerSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    removeEventListenerSpy.mockRestore();
  });
});
