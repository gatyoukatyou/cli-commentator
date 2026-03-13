import { describe, expect, it } from "vitest";
import { LAUNCH_PRESETS, buildLaunchDraft, buildLaunchSessionInput } from "./session-launcher";

describe("session-launcher", () => {
  it("exposes expected built-in presets", () => {
    expect(LAUNCH_PRESETS.map((preset) => preset.id)).toEqual(["bash", "codex", "claude", "custom"]);
  });

  it("builds codex preset with fixed source mode", () => {
    const draft = buildLaunchDraft("codex", "kansai", "/repo");
    expect(draft.cmd).toBe("codex");
    expect(draft.args).toBe("--no-alt-screen");
    expect(draft.logSource).toBe("codex");
    expect(draft.cwd).toBe("/repo");
  });

  it("normalizes launch input before sending", () => {
    const input = buildLaunchSessionInput({
      presetId: "custom",
      name: "  custom  ",
      cmd: "  node  ",
      args: "  script.js   --watch ",
      cwd: " /tmp/project ",
      style: "standard",
      logSource: "auto",
      narrationProvider: "local",
      explanationProvider: "openai",
    });

    expect(input).toEqual({
      name: "custom",
      cmd: "node",
      args: ["script.js", "--watch"],
      cwd: "/tmp/project",
      style: "standard",
      logSource: "auto",
      narrationProvider: "local",
      explanationProvider: "openai",
    });
  });
});
