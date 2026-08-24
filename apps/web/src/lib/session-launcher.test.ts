import { describe, expect, it } from "vitest";
import { LAUNCH_PRESETS, buildLaunchDraft, buildLaunchSessionInput, getLaunchButtonLabel } from "./session-launcher";

describe("session-launcher", () => {
  it("exposes expected built-in presets", () => {
    expect(LAUNCH_PRESETS.map((preset) => preset.id)).toEqual(["claude", "codex", "hermes", "bash", "custom"]);
    expect(LAUNCH_PRESETS.find((preset) => preset.recommended)?.id).toBe("claude");
  });

  it("builds codex preset with fixed source mode", () => {
    const draft = buildLaunchDraft("codex", "kansai", "/repo");
    expect(draft.cmd).toBe("codex");
    expect(draft.args).toBe("--no-alt-screen");
    expect(draft.logSource).toBe("codex");
    expect(draft.cwd).toBe("/repo");
  });

  it("builds Hermes Agent preset with fixed source mode", () => {
    const draft = buildLaunchDraft("hermes", "standard", "/repo");
    expect(draft.cmd).toBe("hermes");
    expect(draft.logSource).toBe("hermes");
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
    });

    expect(input).toEqual({
      name: "custom",
      cmd: "node",
      args: ["script.js", "--watch"],
      cwd: "/tmp/project",
      style: "standard",
      logSource: "auto",
    });
  });

  it("describes the next launch action without requiring instructions", () => {
    const draft = buildLaunchDraft("claude", "standard");
    expect(getLaunchButtonLabel(draft, false)).toBe("サーバー接続待ち");
    expect(getLaunchButtonLabel(draft, true)).toBe("Claude Codeを起動");
    expect(getLaunchButtonLabel(buildLaunchDraft("custom", "standard"), true)).toBe("CLIを起動");
  });
});
