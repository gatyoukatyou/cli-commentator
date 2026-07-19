import {
  DEFAULT_TTS_SETTINGS,
  TTS_PRESETS,
  detectTTSPreset,
  type TTSPresetId,
  type TTSSettings,
} from "../lib/tts";

type TTSPresetSelectValue = TTSPresetId | "custom";

type TTSSettingsPanelProps = {
  settings: TTSSettings;
  voices: SpeechSynthesisVoice[];
  voicesLoaded: boolean;
  onPresetChange: (presetId: TTSPresetSelectValue) => void;
  onSettingsChange: (settings: TTSSettings) => void;
  onTestSpeak: () => void;
  onResetLog: () => void;
};

export function TTSSettingsPanel({
  settings,
  voices,
  voicesLoaded,
  onPresetChange,
  onSettingsChange,
  onTestSpeak,
  onResetLog,
}: TTSSettingsPanelProps) {
  const presetValue: TTSPresetSelectValue = detectTTSPreset(settings) ?? "custom";

  return (
    <div className="tts-settings">
      <div className="tts-settings__field">
        <label className="tts-settings__label">プリセット:</label>
        <select
          value={presetValue}
          onChange={(e) => onPresetChange(e.target.value as TTSPresetSelectValue)}
          style={{ width: "100%", padding: "var(--space-1)" }}
        >
          {TTS_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}（{preset.description}）
            </option>
          ))}
          <option value="custom">カスタム（手動調整）</option>
        </select>
      </div>

      <div className="tts-settings__field">
        <label className="tts-settings__label">音声:</label>
        {voices.length > 0 ? (
          <select
            value={settings.voiceURI ?? ""}
            onChange={(e) => onSettingsChange({ ...settings, voiceURI: e.target.value || null })}
            style={{ width: "100%", padding: "var(--space-1)" }}
          >
            <option value="">デフォルト</option>
            {voices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name} ({voice.lang})
              </option>
            ))}
          </select>
        ) : voicesLoaded ? (
          <span className="tts-settings__helper">音声一覧は取得できません（デフォルト音声のみ）</span>
        ) : (
          <span className="tts-settings__helper">音声リストを読み込み中...</span>
        )}
      </div>

      <div className="tts-settings__field">
        <label className="tts-settings__label">速度: {settings.rate.toFixed(1)}</label>
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          value={settings.rate}
          onChange={(e) => onSettingsChange({ ...settings, rate: parseFloat(e.target.value) })}
          style={{ width: "100%" }}
        />
        <div className="tts-settings__range-labels">
          <span>遅い (0.5)</span>
          <span>速い (2.0)</span>
        </div>
      </div>

      <div className="tts-settings__field">
        <label className="tts-settings__label">音程: {settings.pitch.toFixed(1)}</label>
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          value={settings.pitch}
          onChange={(e) => onSettingsChange({ ...settings, pitch: parseFloat(e.target.value) })}
          style={{ width: "100%" }}
        />
        <div className="tts-settings__range-labels">
          <span>低い (0.5)</span>
          <span>高い (2.0)</span>
        </div>
      </div>

      <div className="tts-settings__field">
        <label className="tts-settings__label">音量: {Math.round(settings.volume * 100)}%</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={settings.volume}
          onChange={(e) => onSettingsChange({ ...settings, volume: parseFloat(e.target.value) })}
          style={{ width: "100%" }}
        />
        <div className="tts-settings__range-labels">
          <span>0%</span>
          <span>100%</span>
        </div>
      </div>

      <div className="tts-settings__field">
        <label className="tts-settings__checkbox">
          <input
            type="checkbox"
            checked={settings.includeRawDetail}
            onChange={(e) => onSettingsChange({ ...settings, includeRawDetail: e.target.checked })}
          />
          <span>原文も読む</span>
        </label>
        <div className="tts-settings__helper">
          オフ: 実況中心で短く読みます。オン: 検出した原文も続けて読みます。
        </div>
      </div>

      <div className="tts-settings__actions">
        <button onClick={onTestSpeak} className="btn-primary">
          テスト読み上げ
        </button>
        <button onClick={() => onSettingsChange(DEFAULT_TTS_SETTINGS)} className="btn-secondary">
          設定をリセット
        </button>
      </div>

      <div className="tts-settings__field tts-evaluation">
        <div className="tts-settings__label">実音声評価ログ</div>
        <div className="tts-settings__helper">
          発話の投入・開始・終了・キャンセル・間引きを現在の計測セッション単位で記録します。
        </div>
        <div className="tts-settings__actions">
          <button onClick={onResetLog} className="btn-secondary">
            計測ログをリセット
          </button>
        </div>
      </div>
    </div>
  );
}
