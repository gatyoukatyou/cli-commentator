import { describe, expect, it } from "vitest";
import { formatSessionStatusLabel, updateSessionEnded } from "./session-status";

describe("formatSessionStatusLabel", () => {
  it("returns the label unchanged while the session is running", () => {
    expect(formatSessionStatusLabel("hermes", false)).toBe("hermes");
  });

  it("marks the session as ended after the PTY exit message", () => {
    expect(formatSessionStatusLabel("hermes", true)).toBe("hermes（終了済み）");
  });

  it("keeps the process running after response completion and later work, then ends on PTY exit and restarts cleanly", () => {
    const responseDone = {
      ts: 1,
      type: "done" as const,
      summary: "Hermesの応答が完了した",
    };
    const followUpWork = {
      ts: 2,
      type: "read" as const,
      summary: "Hermesがファイルを読んでいる",
    };

    let sessionEnded = false;
    sessionEnded = updateSessionEnded(sessionEnded, { kind: "event", ev: responseDone });
    expect(formatSessionStatusLabel("hermes", sessionEnded)).toBe("hermes");

    sessionEnded = updateSessionEnded(sessionEnded, { kind: "event", ev: followUpWork });
    expect(formatSessionStatusLabel("hermes", sessionEnded)).toBe("hermes");

    sessionEnded = updateSessionEnded(sessionEnded, { kind: "ptyExit" });
    expect(formatSessionStatusLabel("hermes", sessionEnded)).toBe("hermes（終了済み）");

    sessionEnded = updateSessionEnded(sessionEnded, { kind: "ptyRestart" });
    expect(formatSessionStatusLabel("hermes", sessionEnded)).toBe("hermes");
  });

  it("falls back to a generic label for an empty label", () => {
    expect(formatSessionStatusLabel("", false)).toBe("session");
    expect(formatSessionStatusLabel("  ", true)).toBe("session（終了済み）");
  });
});
