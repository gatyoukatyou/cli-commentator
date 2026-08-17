import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPtyResizeCoalescer, sendPtyResize } from "./pty-resize";

const COALESCE_DELAY_MS = 50;

function resizeMessage(cols: number, rows: number) {
  return JSON.stringify({ kind: "resizePty", cols, rows });
}

describe("sendPtyResize", () => {
  it("sends the latest terminal dimensions over an open socket", () => {
    const send = vi.fn();

    expect(sendPtyResize({ readyState: 1, send }, { cols: 96, rows: 32 })).toBe(true);
    expect(send).toHaveBeenCalledWith(JSON.stringify({ kind: "resizePty", cols: 96, rows: 32 }));
  });

  it("waits when the socket or dimensions are unavailable", () => {
    const send = vi.fn();

    expect(sendPtyResize(null, { cols: 96, rows: 32 })).toBe(false);
    expect(sendPtyResize({ readyState: 0, send }, { cols: 96, rows: 32 })).toBe(false);
    expect(sendPtyResize({ readyState: 1, send }, null)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("createPtyResizeCoalescer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces a burst and sends the final size after the quiet period", () => {
    const send = vi.fn();
    const coalescer = createPtyResizeCoalescer({
      getSocket: () => ({ readyState: 1, send }),
      delayMs: COALESCE_DELAY_MS,
    });

    for (let index = 0; index < 10; index += 1) {
      coalescer.schedule({ cols: 80 + index, rows: 24 + index });
    }

    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(COALESCE_DELAY_MS - 1);
    expect(send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(resizeMessage(89, 33));
    coalescer.dispose();
  });

  it("replaces a pending size when another resize arrives before the timer fires", () => {
    const send = vi.fn();
    const coalescer = createPtyResizeCoalescer({
      getSocket: () => ({ readyState: 1, send }),
      delayMs: COALESCE_DELAY_MS,
    });

    coalescer.schedule({ cols: 100, rows: 40 });
    vi.advanceTimersByTime(COALESCE_DELAY_MS - 1);
    coalescer.schedule({ cols: 120, rows: 45 });
    vi.advanceTimersByTime(COALESCE_DELAY_MS - 1);
    expect(send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(resizeMessage(120, 45));
    coalescer.dispose();
  });

  it("does not resend the same size", () => {
    const send = vi.fn();
    const coalescer = createPtyResizeCoalescer({
      getSocket: () => ({ readyState: 1, send }),
      delayMs: COALESCE_DELAY_MS,
    });
    const size = { cols: 96, rows: 32 };

    coalescer.schedule(size);
    vi.advanceTimersByTime(COALESCE_DELAY_MS);
    coalescer.schedule(size);
    vi.advanceTimersByTime(COALESCE_DELAY_MS);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(resizeMessage(96, 32));
    coalescer.dispose();
  });

  it("resends the latest size immediately after reconnecting", () => {
    const send = vi.fn();
    let socket: { readyState: 0 | 1; send: typeof send } = { readyState: 0, send };
    const coalescer = createPtyResizeCoalescer({
      getSocket: () => socket,
      delayMs: COALESCE_DELAY_MS,
    });

    coalescer.schedule({ cols: 110, rows: 38 });
    vi.advanceTimersByTime(COALESCE_DELAY_MS);
    expect(send).not.toHaveBeenCalled();

    socket = { readyState: 1, send };
    expect(coalescer.resendLatest()).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(resizeMessage(110, 38));
    vi.runAllTimers();
    expect(send).toHaveBeenCalledTimes(1);
    coalescer.dispose();
  });

  it("does not send a pending resize after disposal", () => {
    const send = vi.fn();
    const coalescer = createPtyResizeCoalescer({
      getSocket: () => ({ readyState: 1, send }),
      delayMs: COALESCE_DELAY_MS,
    });

    coalescer.schedule({ cols: 130, rows: 50 });
    coalescer.dispose();
    vi.advanceTimersByTime(COALESCE_DELAY_MS);

    expect(send).not.toHaveBeenCalled();
  });
});
