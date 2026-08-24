import type { Dispatch, SetStateAction } from "react";
import { LAUNCH_PRESETS, getLaunchButtonLabel, type LaunchDraft, type LaunchPresetId } from "../lib/session-launcher";
import type { Style } from "../types";
import { sourceLabel } from "../lib/source-label";

type LauncherPanelProps = {
  launchDraft: LaunchDraft;
  setLaunchDraft: Dispatch<SetStateAction<LaunchDraft>>;
  style: Style;
  connected: boolean;
  onSelectPreset: (presetId: LaunchPresetId) => void;
  onLaunch: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  currentSessionLabel: string;
};

export function LauncherPanel({
  launchDraft,
  setLaunchDraft,
  style,
  connected,
  onSelectPreset,
  onLaunch,
  collapsed,
  onToggleCollapsed,
  currentSessionLabel,
}: LauncherPanelProps) {
  return (
    <div className={`panel launcher-panel ${collapsed ? "launcher-panel--collapsed" : ""}`}>
      <div className="launcher-panel__header">
        <div>
          <div className="launcher-panel__title">実況を始める</div>
          {collapsed && <div className="launcher-panel__collapsed-status">現在のセッション: {currentSessionLabel}</div>}
        </div>
        <button
          type="button"
          className="launcher-panel__toggle"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : "launcher-panel-content"}
        >
          {collapsed ? "設定を表示" : "設定を隠す"}
        </button>
      </div>
      {!collapsed && (
        <div id="launcher-panel-content">
          <div className="launcher-panel__hint">3ステップでAIの作業をこの画面から監督できます。</div>
          <div className="launcher-panel__toolbar">
            <div className="launcher-panel__step">
              <div className="launcher-panel__step-label">1. 起動するAIを選ぶ</div>
              <div className="launcher-panel__presets" role="tablist" aria-label="起動するCLI">
                {LAUNCH_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    role="tab"
                    aria-selected={launchDraft.presetId === preset.id}
                    className={`launcher-panel__preset ${launchDraft.presetId === preset.id ? "launcher-panel__preset--active" : ""}`}
                    onClick={() => onSelectPreset(preset.id)}
                    title={preset.description}
                  >
                    {preset.label}{preset.recommended ? "（推奨）" : ""}
                  </button>
                ))}
              </div>
            </div>
            <label className="launcher-panel__field launcher-panel__field--cwd">
              <span>2. 作業フォルダを指定（空欄なら既定のフォルダ）</span>
              <input value={launchDraft.cwd} onChange={(e) => setLaunchDraft((prev) => ({ ...prev, cwd: e.target.value }))} placeholder="例: /path/to/project" />
            </label>
            <button type="button" className="debug-panel__btn debug-panel__btn--primary launcher-panel__launch-btn" onClick={onLaunch} disabled={!connected}>
              3. {getLaunchButtonLabel(launchDraft, connected)}
            </button>
          </div>
          <details className="launcher-panel__advanced">
            <summary>詳細設定（通常は変更不要）</summary>
            <div className="launcher-panel__advanced-fields">
              <label className="launcher-panel__field launcher-panel__field--cmd">
                <span>コマンド</span>
                <input
                  value={launchDraft.cmd}
                  onChange={(e) => setLaunchDraft((prev) => ({ ...prev, cmd: e.target.value, presetId: "custom", name: prev.presetId === "custom" ? prev.name : "Custom" }))}
                  placeholder="bash / codex / claude / hermes"
                />
              </label>
              <label className="launcher-panel__field launcher-panel__field--args">
                <span>引数</span>
                <input value={launchDraft.args} onChange={(e) => setLaunchDraft((prev) => ({ ...prev, args: e.target.value }))} placeholder="--no-alt-screen" />
              </label>
            </div>
          </details>
          <div className="launcher-panel__meta">
            実況口調: {style} ／ ログ判定: {sourceLabel(launchDraft.logSource)}
          </div>
        </div>
      )}
    </div>
  );
}
