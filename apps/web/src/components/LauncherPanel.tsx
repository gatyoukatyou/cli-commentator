import type { Dispatch, SetStateAction } from "react";
import { LAUNCH_PRESETS, type LaunchDraft, type LaunchPresetId } from "../lib/session-launcher";
import type { Style } from "../types";

type LauncherPanelProps = {
  launchDraft: LaunchDraft;
  setLaunchDraft: Dispatch<SetStateAction<LaunchDraft>>;
  style: Style;
  connected: boolean;
  onSelectPreset: (presetId: LaunchPresetId) => void;
  onLaunch: () => void;
};

export function LauncherPanel({ launchDraft, setLaunchDraft, style, connected, onSelectPreset, onLaunch }: LauncherPanelProps) {
  return (
    <div className="panel launcher-panel">
      <div className="launcher-panel__header">
        <div className="launcher-panel__title">Quick Launch</div>
        <div className="launcher-panel__hint">ここから直接 CLI を起動します。</div>
      </div>
      <div className="launcher-panel__toolbar">
        <div className="launcher-panel__presets" role="tablist" aria-label="launch presets">
          {LAUNCH_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`launcher-panel__preset ${launchDraft.presetId === preset.id ? "launcher-panel__preset--active" : ""}`}
              onClick={() => onSelectPreset(preset.id)}
              title={preset.description}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <label className="launcher-panel__field launcher-panel__field--cwd">
          <span>作業ディレクトリ</span>
          <input value={launchDraft.cwd} onChange={(e) => setLaunchDraft((prev) => ({ ...prev, cwd: e.target.value }))} placeholder="/path/to/repo" />
        </label>
        <label className="launcher-panel__field launcher-panel__field--cmd">
          <span>コマンド</span>
          <input
            value={launchDraft.cmd}
            onChange={(e) => setLaunchDraft((prev) => ({ ...prev, cmd: e.target.value, presetId: "custom", name: prev.presetId === "custom" ? prev.name : "Custom" }))}
            placeholder="bash / codex / claude"
          />
        </label>
        <label className="launcher-panel__field launcher-panel__field--args">
          <span>引数</span>
          <input value={launchDraft.args} onChange={(e) => setLaunchDraft((prev) => ({ ...prev, args: e.target.value }))} placeholder="--no-alt-screen" />
        </label>
        <button type="button" className="debug-panel__btn debug-panel__btn--primary launcher-panel__launch-btn" onClick={onLaunch} disabled={!connected}>
          起動
        </button>
      </div>
      <div className="launcher-panel__meta">
        口調 `{style}` / source `{launchDraft.logSource}` で起動します。
      </div>
    </div>
  );
}
