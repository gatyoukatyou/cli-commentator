import { describe, expect, it } from "vitest";
import { getLauncherPanelCollapsed } from "./launcher-panel-state";

describe("getLauncherPanelCollapsed", () => {
  it("keeps the setup visible before a non-bash session starts", () => {
    expect(getLauncherPanelCollapsed("bash", null)).toBe(false);
  });

  it("collapses automatically for an active CLI session", () => {
    expect(getLauncherPanelCollapsed("hermes --tui", null)).toBe(true);
  });

  it("allows the user to override the automatic state", () => {
    expect(getLauncherPanelCollapsed("hermes --tui", false)).toBe(false);
    expect(getLauncherPanelCollapsed("bash", true)).toBe(true);
  });
});
