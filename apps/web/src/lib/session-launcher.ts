import type { LaunchSessionInput, ProviderName, SourceState, Style } from "../types";

export type LaunchPresetId = "bash" | "codex" | "claude" | "custom";

export type LaunchDraft = {
  presetId: LaunchPresetId;
  name: string;
  cmd: string;
  args: string;
  cwd: string;
  style: Style;
  logSource: SourceState["mode"];
  narrationProvider?: ProviderName;
  explanationProvider?: ProviderName;
};

export type LaunchPreset = {
  id: LaunchPresetId;
  label: string;
  description: string;
};

const PRESET_CONFIG: Record<
  LaunchPresetId,
  { label: string; description: string; cmd: string; args: string; logSource: SourceState["mode"] }
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
  },
  custom: {
    label: "Custom",
    description: "任意コマンドを起動",
    cmd: "",
    args: "",
    logSource: "auto",
  },
};

export const LAUNCH_PRESETS: LaunchPreset[] = (Object.entries(PRESET_CONFIG) as Array<
  [LaunchPresetId, (typeof PRESET_CONFIG)[LaunchPresetId]]
>).map(([id, config]) => ({
  id,
  label: config.label,
  description: config.description,
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
    narrationProvider: draft.narrationProvider,
    explanationProvider: draft.explanationProvider,
  };
}
