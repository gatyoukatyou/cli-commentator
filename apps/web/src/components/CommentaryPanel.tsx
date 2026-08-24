import type { Dispatch, SetStateAction } from "react";
import type { CommentaryItem } from "../lib/log-filter";
import type { TTSPresetId, TTSSettings } from "../lib/tts";
import type { CommentaryDisplayMode, SourceState, Style } from "../types";
import { sourceLabel as getSourceLabel } from "../lib/source-label";
import { CommentaryLog } from "./CommentaryLog";
import { TTSSettingsPanel } from "./TTSSettingsPanel";

const COMMENTARY_DISPLAY_MODE_OPTIONS: Array<{ value: CommentaryDisplayMode; label: string }> = [
  { value: "both", label: "実況＋解説" },
  { value: "narration", label: "実況のみ" },
  { value: "explanation", label: "解説のみ" },
];

type CommentaryPanelProps = {
  source: SourceState;
  style: Style;
  displayMode: CommentaryDisplayMode;
  items: CommentaryItem[];
  ttsSupported: boolean;
  ttsEnabled: boolean;
  ttsSettingsOpen: boolean;
  setTtsSettingsOpen: Dispatch<SetStateAction<boolean>>;
  ttsSettings: TTSSettings;
  voices: SpeechSynthesisVoice[];
  voicesLoaded: boolean;
  onStyleChange: (style: Style) => void;
  onDisplayModeChange: (mode: CommentaryDisplayMode) => void;
  onTTSToggle: (enabled: boolean) => void;
  onTTSPresetChange: (presetId: TTSPresetId | "custom") => void;
  onTTSSettingsChange: (settings: TTSSettings) => void;
  onTestSpeak: () => void;
  onExportTTSLog: () => void;
  onResetTTSLog: () => void;
};

export function CommentaryPanel({
  source,
  style,
  displayMode,
  items,
  ttsSupported,
  ttsEnabled,
  ttsSettingsOpen,
  setTtsSettingsOpen,
  ttsSettings,
  voices,
  voicesLoaded,
  onStyleChange,
  onDisplayModeChange,
  onTTSToggle,
  onTTSPresetChange,
  onTTSSettingsChange,
  onTestSpeak,
  onExportTTSLog,
  onResetTTSLog,
}: CommentaryPanelProps) {
  const sourceDisplay =
    source.mode === "auto"
      ? source.detected
        ? `auto → ${getSourceLabel(source.detected)}`
        : "auto (detecting)"
      : getSourceLabel(source.mode);

  return (
    <div className="workspace-column workspace-column--right">
      <div className="panel commentary-panel">
        <div className="commentary-panel__header">
          <div>
            <div className="commentary-panel__title">実況と解説</div>
            <div className="commentary-panel__hint">現在の CLI 出力を整理して右側に表示します。</div>
          </div>
          <div className="commentary-panel__status">Ruleset: {sourceDisplay}</div>
        </div>

        <div className="control-row">
          <label className="control-row__label">口調：</label>
          <select value={style} onChange={(e) => onStyleChange(e.target.value as Style)}>
            <option value="standard">標準</option>
            <option value="kansai">関西弁</option>
            <option value="zundamon">ずんだもん風（テキスト）</option>
          </select>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-fg-tertiary)" }}>
            （イベント時＋最大2秒に1回）
          </span>
        </div>

        <div className="control-row">
          <label className="control-row__label">表示：</label>
          <select value={displayMode} onChange={(e) => onDisplayModeChange(e.target.value as CommentaryDisplayMode)}>
            {COMMENTARY_DISPLAY_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-fg-tertiary)" }}>
            用語補足は表示モードに関係なく別枠で表示します
          </span>
        </div>

        <div className="control-row">
          <label className="control-row__label" style={{ cursor: ttsSupported ? "pointer" : "not-allowed" }}>
            <input
              type="checkbox"
              checked={ttsEnabled}
              onChange={(e) => onTTSToggle(e.target.checked)}
              disabled={!ttsSupported}
              style={{ marginRight: "var(--space-2)" }}
            />
            読み上げ（TTS）
          </label>
          {ttsSupported && ttsEnabled && (
            <button
              onClick={() => setTtsSettingsOpen((prev) => !prev)}
              className={`settings-toggle ${ttsSettingsOpen ? "settings-toggle--active" : ""}`}
            >
              {ttsSettingsOpen ? "▼ 設定" : "▶ 設定"}
            </button>
          )}
          {ttsSupported && (
            <button onClick={onExportTTSLog} className="settings-toggle">
              評価ログをJSON出力
            </button>
          )}
          {!ttsSupported && (
            <span style={{ fontSize: "var(--text-sm)", color: "var(--color-danger)" }}>
              ※ このブラウザはTTS非対応です
            </span>
          )}
        </div>

        {ttsSupported && ttsEnabled && ttsSettingsOpen && (
          <TTSSettingsPanel
            settings={ttsSettings}
            voices={voices}
            voicesLoaded={voicesLoaded}
            onPresetChange={onTTSPresetChange}
            onSettingsChange={onTTSSettingsChange}
            onTestSpeak={onTestSpeak}
            onResetLog={onResetTTSLog}
          />
        )}

        <CommentaryLog items={items} displayMode={displayMode} />
      </div>
    </div>
  );
}
