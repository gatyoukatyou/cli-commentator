import type { LaunchSessionInput, SourceState, Style } from "../types";

export type LaunchPresetId = "bash" | "codex" | "claude" | "custom";

export type LaunchDraft = {
  presetId: LaunchPresetId;
  name: string;
  cmd: string;
  args: string;
  cwd: string;
  style: Style;
  logSource: SourceState["mode"];
};

export type LaunchPreset = {
  id: LaunchPresetId;
  label: string;
  description: string;
  recommended?: boolean;
};

const PRESET_CONFIG: Record<
  LaunchPresetId,
  { label: string; description: string; cmd: string; args: string; logSource: SourceState["mode"]; recommended?: boolean }
> = {
  bash: {
    label: "bash",
    description: "汎用シェルを起動",
    cmd: "bash",
    args: "",
    logSource: "auto",
  },
  codex: {
    label: "Codex",
    description: "Codex CLI をそのまま起動",
    cmd: "codex",
    args: "--no-alt-screen",
    logSource: "codex",
  },
  claude: {
    label: "Claude Code",
    description: "Claude Code を PTY で起動",
    cmd: "claude",
    args: "",
    logSource: "claude",
    recommended: true,
  },
  custom: {
    label: "Custom",
    description: "任意コマンドを起動",
    cmd: "",
    args: "",
    logSource: "auto",
  },
};

const PRESET_ORDER: LaunchPresetId[] = ["claude", "codex", "bash", "custom"];

export const LAUNCH_PRESETS: LaunchPreset[] = PRESET_ORDER.map((id) => ({
  id,
  label: PRESET_CONFIG[id].label,
  description: PRESET_CONFIG[id].description,
  recommended: PRESET_CONFIG[id].recommended,
}));

export function buildLaunchDraft(presetId: LaunchPresetId, style: Style, cwd = ""): LaunchDraft {
  const config = PRESET_CONFIG[presetId];
  return {
    presetId,
    name: config.label,
    cmd: config.cmd,
    args: config.args,
    cwd,
    style,
    logSource: config.logSource,
  };
}

export function buildLaunchSessionInput(draft: LaunchDraft): LaunchSessionInput {
  const cmd = draft.cmd.trim();
  return {
    name: draft.name.trim() || undefined,
    cmd,
    args: draft.args
      .trim()
      .split(/\s+/)
      .filter(Boolean),
    cwd: draft.cwd.trim() || undefined,
    style: draft.style,
    logSource: draft.logSource,
  };
}

export function getLaunchButtonLabel(draft: LaunchDraft, connected: boolean): string {
  if (!connected) return "サーバー接続待ち";
  if (draft.presetId === "custom") return "CLIを起動";
  return `${PRESET_CONFIG[draft.presetId].label}を起動`;
}
