import { describe, expect, it } from "vitest";
import { buildServerStateEvent, formatServerStateEvent } from "../runtime/state-event.js";

describe("runtime/state-event", () => {
  it("builds a structured server state event", () => {
    const event = buildServerStateEvent({
      trigger: "restart_begin",
      from: "pty_running",
      to: "restarting",
      inputMode: "pty",
      profileId: "profile-1",
      detail: "switching profile",
    });

    expect(event).toMatchObject({
      trigger: "restart_begin",
      from: "pty_running",
      to: "restarting",
      inputMode: "pty",
      profileId: "profile-1",
      detail: "switching profile",
    });
    expect(typeof event.ts).toBe("number");
  });

  it("normalizes missing detail to null", () => {
    const event = buildServerStateEvent({
      trigger: "bootstrap",
      from: "booting",
      to: "starting",
      inputMode: "pty",
      profileId: null,
    });
    expect(event.detail).toBeNull();
  });

  it("formats event log line as JSON payload", () => {
    const event = buildServerStateEvent({
      trigger: "cleanup_complete",
      from: "shutting_down",
      to: "stopped",
      inputMode: "file",
      profileId: null,
      detail: "exit_code=0",
    });
    const line = formatServerStateEvent(event);
    expect(line.startsWith("[server/state-event] ")).toBe(true);
    const parsed = JSON.parse(line.replace("[server/state-event] ", ""));
    expect(parsed).toEqual(event);
  });
});
