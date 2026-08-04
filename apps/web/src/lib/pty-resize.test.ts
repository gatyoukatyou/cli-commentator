import { describe, expect, it, vi } from "vitest";
import { sendPtyResize } from "./pty-resize";

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
