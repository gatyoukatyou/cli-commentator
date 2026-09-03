import { describe, expect, it } from "vitest";
import { formatSessionStatusLabel } from "./session-status";

describe("formatSessionStatusLabel", () => {
  it("returns the label unchanged while the session is running", () => {
    expect(formatSessionStatusLabel("hermes", false)).toBe("hermes");
  });

  it("marks the session as ended after the done event", () => {
    expect(formatSessionStatusLabel("hermes", true)).toBe("hermes（終了済み）");
  });

  it("falls back to a generic label for an empty label", () => {
    expect(formatSessionStatusLabel("", false)).toBe("session");
    expect(formatSessionStatusLabel("  ", true)).toBe("session（終了済み）");
  });
});
