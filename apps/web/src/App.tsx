import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { ProfileSelector } from "./components/ProfileSelector";
import type { TerminalPaneHandle, TerminalPaneTheme } from "./components/TerminalPane";
import {
  TTS_PRESETS,
  DEFAULT_TTS_SETTINGS,
  detectTTSPreset,
  type TTSPresetId,
} from "./lib/tts";
import { useTTS } from "./hooks/useTTS";
import { useCommentatorSocket, type PtyUnavailableNotice } from "./hooks/useCommentatorSocket";
import {
  EVENT_TYPE_LABELS,
  EVENT_TYPE_OPTIONS,
  filterCommentaryItems,
  groupCommentaryItems,
  type CommentaryItem,
  type LogEventTypeFilter,
} from "./lib/log-filter";
import { getCommentaryTextParts } from "./lib/glossary-note";
import {
  LAUNCH_PRESETS,
  buildLaunchDraft,
  buildLaunchSessionInput,
  type LaunchDraft,
  type LaunchPresetId,
} from "./lib/session-launcher";
import { copyWithFallback, getTauriCore, type ServerStatusDetail } from "./lib/tauri";
import type {
  CommentaryDisplayMode,
  Style,
  SourceState,
  Profile,
  ProfileSummary,
  CreateProfileInput,
  InputMode,
} from "./types";

const TerminalPane = lazy(() => import("./components/TerminalPane"));
const ProfileEditor = lazy(() =>
  import("./components/ProfileEditor").then((module) => ({
    default: module.ProfileEditor,
  }))
);
const TauriStatusPanel = lazy(() => import("./components/TauriStatusPanel"));

export type Skin = "standard" | "cli";

type TTSPresetSelectValue = TTSPresetId | "custom";

const LOG_AUTO_SCROLL_THRESHOLD_PX = 64;
const GENERIC_LOG_SUMMARIES = new Set(["ログ更新"]);
const GROUP_DETAIL_PREVIEW_COUNT = 3;
const TERMINAL_OUTPUT_MAX_CHARS = 24000;
const COMMENTARY_DISPLAY_MODE_OPTIONS: Array<{ value: CommentaryDisplayMode; label: string }> = [
  { value: "both", label: "実況＋解説" },
  { value: "narration", label: "実況のみ" },
  { value: "explanation", label: "解説のみ" },
];

function isSkin(value: string | null): value is Skin {
  return value === "standard" || value === "cli";
}

function getTerminalTheme(skin: Skin): TerminalPaneTheme {
  if (skin === "cli") {
    return {
      background: "#081019",
      foreground: "#d8f3dc",
      cursor: "#38bdf8",
      selectionBackground: "rgba(56, 189, 248, 0.24)",
    };
  }

  return {
    background: "#f8fafc",
    foreground: "#213547",
    cursor: "#2563eb",
    selectionBackground: "rgba(37, 99, 235, 0.18)",
  };
}

const normalizeSuggestion = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const unique = (values: Array<string | undefined>): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeSuggestion(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const formatLogTimeRange = (startTs: number, endTs: number): string => {
  const start = new Date(startTs).toLocaleTimeString();
  if (startTs === endTs) return start;
  const end = new Date(endTs).toLocaleTimeString();
  return `${start} - ${end}`;
};

export default function App() {
  const isTauriRuntime = Boolean(getTauriCore());
  const [items, setItems] = useState<CommentaryItem[]>([]);
  const [logQuery, setLogQuery] = useState("");
  const [logEventType, setLogEventType] = useState<LogEventTypeFilter>("all");
  const [style, setStyle] = useState<Style>("kansai");
  const [source, setSource] = useState<SourceState>({ mode: "auto", detected: null });
  const [launchDraft, setLaunchDraft] = useState<LaunchDraft>(() => buildLaunchDraft("bash", "kansai"));
  const [currentSessionLabel, setCurrentSessionLabel] = useState("bash");
  const [tauriServerPort, setTauriServerPort] = useState<number | null>(null);
  const [skin, setSkin] = useState<Skin>(() => {
    const saved = localStorage.getItem("cli-commentator-skin");
    return isSkin(saved) ? saved : "standard";
  });
  const [commentaryDisplayMode, setCommentaryDisplayMode] = useState<CommentaryDisplayMode>(() => {
    const saved = localStorage.getItem("cli-commentator-display-mode");
    return saved === "narration" || saved === "explanation" || saved === "both" ? saved : "both";
  });
  const pendingEditIdRef = useRef<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalPaneRef = useRef<TerminalPaneHandle | null>(null);
  const shouldStickLogRef = useRef(true);

  // Profile state
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<Profile | null | "new" | "loading">(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const profilesRef = useRef<ProfileSummary[]>([]);

  // PTY unavailable state (when node-pty build fails)
  const [ptyUnavailable, setPtyUnavailable] = useState<PtyUnavailableNotice | null>(null);
  const [ptyError, setPtyError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pendingTerminalOutput, setPendingTerminalOutput] = useState("");
  const {
    ttsEnabled,
    ttsSettings,
    ttsSettingsOpen,
    setTtsSettingsOpen,
    voices,
    voicesLoaded,
    ttsSupported,
    clearPendingSpeech,
    stopAndClearSpeech,
    queueSpeech,
    handleTTSToggle,
    handleTTSSettingsChange,
    handleTTSPresetChange,
    handleTestSpeak,
  } = useTTS({ commentaryDisplayMode });

  const defaultWsPort = useMemo(() => {
    const parsed = Number(import.meta.env.VITE_WS_PORT ?? "8787");
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 8787;
  }, []);

  const handleDesktopStatusChange = useCallback((status: ServerStatusDetail | null) => {
    setTauriServerPort(status?.port ?? null);
  }, []);

  const wsUrl = useMemo(() => {
    const port = isTauriRuntime ? tauriServerPort ?? defaultWsPort : defaultWsPort;
    return `ws://localhost:${port}`;
  }, [defaultWsPort, isTauriRuntime, tauriServerPort]);

  const terminalTheme = useMemo(() => getTerminalTheme(skin), [skin]);

  // Apply skin to document
  useEffect(() => {
    document.documentElement.setAttribute("data-skin", skin);
    localStorage.setItem("cli-commentator-skin", skin);
  }, [skin]);

  useEffect(() => {
    localStorage.setItem("cli-commentator-display-mode", commentaryDisplayMode);
  }, [commentaryDisplayMode]);

  // Profile ref sync (to avoid stale closure in WebSocket handler)
  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  // Copy feedback cleanup/reset
  useEffect(() => {
    return () => {
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current);
      }
    };
  }, []);

  const writeToTerminal = useCallback((data: string) => {
    if (!data) return;
    const terminal = terminalPaneRef.current;
    if (!terminal) {
      setPendingTerminalOutput((prev) => {
        const next = prev + data;
        return next.length > TERMINAL_OUTPUT_MAX_CHARS ? next.slice(-TERMINAL_OUTPUT_MAX_CHARS) : next;
      });
      return;
    }
    terminal.write(data);
  }, []);

  const clearTerminal = useCallback(() => {
    setPendingTerminalOutput("");
    terminalPaneRef.current?.clear();
  }, []);

  const handlePendingTerminalOutputFlushed = useCallback(() => {
    setPendingTerminalOutput("");
  }, []);

  const handleCopySuggestion = async () => {
    const suggestion = normalizeSuggestion(ptyUnavailable?.suggestion);
    if (!suggestion) return;
    const ok = await copyWithFallback(suggestion);
    setCopyState(ok ? "copied" : "failed");
    if (copyResetRef.current) {
      clearTimeout(copyResetRef.current);
    }
    copyResetRef.current = setTimeout(() => {
      setCopyState("idle");
    }, 1500);
  };

  const { wsRef, connectionStatus } = useCommentatorSocket({
    wsUrl,
    pendingEditIdRef,
    profilesRef,
    terminalPaneRef,
    setItems,
    setStyle,
    setSource,
    setProfiles,
    setActiveProfileId,
    setEditingProfile,
    setProfileError,
    setPtyError,
    setPtyUnavailable,
    setCopyState,
    setCurrentSessionLabel,
    writeToTerminal,
    clearTerminal,
    queueSpeech,
    clearPendingSpeech,
    stopAndClearSpeech,
  });

  const sendTerminalInput = useCallback(
    (data: string) => {
      if (!data) return;
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        setPtyError("サーバーに接続されていません");
        return;
      }
      wsRef.current.send(JSON.stringify({ kind: "writeInput", data }));
    },
    [wsRef]
  );

  const sendStyle = (s: Style) => {
    setStyle(s);
    // D-2: Only send when connection is open
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ kind: "setStyle", style: s }));
    }
  };

  const handleSelectLaunchPreset = (presetId: LaunchPresetId) => {
    setLaunchDraft((prev) => {
      const next = buildLaunchDraft(presetId, style, prev.cwd);
      if (presetId === "custom") {
        return {
          ...next,
          cmd: prev.presetId === "custom" ? prev.cmd : next.cmd,
          args: prev.presetId === "custom" ? prev.args : next.args,
        };
      }
      return next;
    });
  };

  const handleLaunchSession = () => {
    setProfileError(null);
    setPtyError(null);
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setProfileError("サーバーに接続されていません。再接続を待ってください。");
      return;
    }

    const session = buildLaunchSessionInput({
      ...launchDraft,
      style,
    });
    if (!session.cmd) {
      setProfileError("起動コマンドを入力してください。");
      return;
    }

    setCurrentSessionLabel(session.name?.trim() || session.cmd);
    wsRef.current.send(JSON.stringify({ kind: "launchSession", session }));
    window.setTimeout(() => {
      terminalPaneRef.current?.focus();
    }, 0);
  };

  // Profile handlers
  const handleSelectProfile = (id: string | null) => {
    setProfileError(null);
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setProfileError("サーバーに接続されていません");
      return;
    }
    wsRef.current.send(JSON.stringify({ kind: "setActiveProfile", id }));
  };

  const handleEditProfile = (id: string) => {
    setProfileError(null);
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setProfileError("サーバーに接続されていません");
      return;
    }
    pendingEditIdRef.current = id;
    setEditingProfile("loading");
    wsRef.current.send(JSON.stringify({ kind: "getProfile", id }));
  };

  const handleCreateProfile = () => {
    setEditingProfile("new");
    setProfileError(null);
  };

  const handleDeleteProfile = (id: string) => {
    setProfileError(null);
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setProfileError("サーバーに接続されていません");
      return;
    }
    wsRef.current.send(JSON.stringify({ kind: "deleteProfile", id }));
  };

  const handleSaveProfile = (input: {
    id?: string;
    name: string;
    cmd: string;
    args: string;
    cwd: string;
    style: Style;
    logSource: SourceState["mode"];
    inputMode: InputMode;
    inputFile: string;
    narrationProvider: string;
    explanationProvider: string;
  }) => {
    setProfileError(null);
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setProfileError("サーバーに接続されていません。再接続を待ってください。");
      return;
    }
    const normalizedName = input.name.trim();
    const normalizedCmd = input.cmd.trim();
    const normalizedCwd = input.cwd.trim();
    const normalizedInputFile = input.inputFile.trim();
    const profile: CreateProfileInput & { id?: string } = {
      id: input.id,
      name: normalizedName,
      cmd: normalizedCmd || (input.inputMode === "file" ? "file" : normalizedCmd),
      args: input.args.trim().split(/\s+/).filter(Boolean),
      cwd: normalizedCwd || undefined,
      style: input.style,
      logSource: input.logSource,
      inputMode: input.inputMode,
      inputFile: normalizedInputFile || undefined,
      narrationProvider: input.narrationProvider
        ? (input.narrationProvider as CreateProfileInput["narrationProvider"])
        : ("" as CreateProfileInput["narrationProvider"]),
      explanationProvider: input.explanationProvider
        ? (input.explanationProvider as CreateProfileInput["explanationProvider"])
        : ("" as CreateProfileInput["explanationProvider"]),
    };
    wsRef.current.send(JSON.stringify({ kind: "saveProfile", profile }));
  };

  const handleCancelEdit = () => {
    setEditingProfile(null);
    setProfileError(null);
    pendingEditIdRef.current = null;
  };

  const suggestionText = normalizeSuggestion(ptyUnavailable?.suggestion);
  const ptyUnavailableError = normalizeSuggestion(ptyUnavailable?.error);
  const hasNotices = Boolean(ptyUnavailable || profileError || ptyError);
  const copyLabel = copyState === "copied" ? "Copied" : "Copy";
  const profileEditorKey =
    editingProfile === "new"
      ? "profile-new"
      : editingProfile && editingProfile !== "loading"
        ? `profile-${editingProfile.id}`
        : "profile-empty";

  const sourceLabel =
    source.mode === "auto"
      ? source.detected
        ? `auto → ${source.detected}`
        : "auto (detecting)"
      : source.mode;
  const ttsPresetValue: TTSPresetSelectValue = detectTTSPreset(ttsSettings) ?? "custom";
  const filteredItems = useMemo(
    () => filterCommentaryItems(items, { query: logQuery, eventType: logEventType }),
    [items, logEventType, logQuery]
  );
  const groupedItems = useMemo(() => groupCommentaryItems(filteredItems), [filteredItems]);

  const handleLogScroll = useCallback(() => {
    const container = logContainerRef.current;
    if (!container) return;
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickLogRef.current = distanceToBottom <= LOG_AUTO_SCROLL_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    const container = logContainerRef.current;
    if (!container || !shouldStickLogRef.current) return;

    const frame = requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });

    return () => cancelAnimationFrame(frame);
  }, [filteredItems]);

  const getStatusIndicatorClass = () => {
    switch (connectionStatus) {
      case "connected":
        return "status-indicator status-indicator--connected";
      case "connecting":
      case "reconnecting":
        return "status-indicator status-indicator--connecting";
      default:
        return "status-indicator status-indicator--disconnected";
    }
  };

  return (
    <div className="app-shell">
      {isTauriRuntime && (
        <Suspense
          fallback={
            <div className="debug-panel">
              <div className="debug-panel__title">Desktop Server</div>
              <p className="debug-panel__hint">状態を読み込み中...</p>
            </div>
          }
        >
          <TauriStatusPanel onStatusChange={handleDesktopStatusChange} />
        </Suspense>
      )}
      {hasNotices && (
        <div className="notices">
          {ptyUnavailable && (
            <div className="notice notice--warning panel">
              <div className="notice__title">PTYが利用できません</div>
              <div className="notice__body">
                <p>PTYが利用できないため、fileモードで起動してください。</p>
                {ptyUnavailableError && <p className="notice__hint">{ptyUnavailableError}</p>}
                {suggestionText ? (
                  <div className="notice__code-row">
                    <pre className="notice__code">
                      <code>{suggestionText}</code>
                    </pre>
                    <div className="notice__actions">
                      <button type="button" className="btn-secondary notice__copy" onClick={handleCopySuggestion}>
                        {copyLabel}
                      </button>
                      {copyState === "failed" && (
                        <span className="notice__copy-hint">コピーできませんでした。手動で選択してください。</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="notice__hint">
                    <code>INPUT_MODE=file</code> でログファイルを指定して起動できます。
                  </p>
                )}
              </div>
            </div>
          )}
          {profileError && (
            <div className="notice notice--error panel">
              <div className="notice__title">プロファイルエラー</div>
              <div className="notice__body">{profileError}</div>
            </div>
          )}
          {ptyError && (
            <div className="notice notice--error panel">
              <div className="notice__title">PTYエラー</div>
              <div className="notice__body">{ptyError}</div>
            </div>
          )}
        </div>
      )}
      <h1>CLI 実況（MVP）</h1>

      {/* Skin selector */}
      <div className="skin-selector">
        <span className="skin-selector__label">スキン：</span>
        <select value={skin} onChange={(e) => setSkin(e.target.value as Skin)}>
          <option value="standard">Standard</option>
          <option value="cli">CLI</option>
        </select>
      </div>

      {/* Connection status indicator */}
      <div className="control-row" style={{ fontSize: "var(--text-sm)" }}>
        <span className={getStatusIndicatorClass()} />
        <span style={{ color: "var(--color-fg-secondary)" }}>
          {connectionStatus === "connected" && "接続中"}
          {connectionStatus === "connecting" && "接続しています..."}
          {connectionStatus === "reconnecting" && "再接続しています..."}
          {connectionStatus === "disconnected" && "切断"}
        </span>
      </div>
      <div className="workspace-layout">
        <div className="workspace-column workspace-column--left">
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
                    onClick={() => handleSelectLaunchPreset(preset.id)}
                    title={preset.description}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <label className="launcher-panel__field launcher-panel__field--cwd">
                <span>作業ディレクトリ</span>
                <input
                  value={launchDraft.cwd}
                  onChange={(e) => setLaunchDraft((prev) => ({ ...prev, cwd: e.target.value }))}
                  placeholder="/path/to/repo"
                />
              </label>
              <label className="launcher-panel__field launcher-panel__field--cmd">
                <span>コマンド</span>
                <input
                  value={launchDraft.cmd}
                  onChange={(e) =>
                    setLaunchDraft((prev) => ({
                      ...prev,
                      cmd: e.target.value,
                      presetId: "custom",
                      name: prev.presetId === "custom" ? prev.name : "Custom",
                    }))
                  }
                  placeholder="bash / codex / claude"
                />
              </label>
              <label className="launcher-panel__field launcher-panel__field--args">
                <span>引数</span>
                <input
                  value={launchDraft.args}
                  onChange={(e) => setLaunchDraft((prev) => ({ ...prev, args: e.target.value }))}
                  placeholder="--no-alt-screen"
                />
              </label>
              <button
                type="button"
                className="debug-panel__btn debug-panel__btn--primary launcher-panel__launch-btn"
                onClick={handleLaunchSession}
                disabled={connectionStatus !== "connected"}
              >
                起動
              </button>
            </div>
            <div className="launcher-panel__meta">
              口調 `{style}` / source `{launchDraft.logSource}` で起動します。
            </div>
          </div>

          <div className="panel terminal-panel">
            <div className="terminal-panel__header">
              <div>
                <div className="terminal-panel__title">Managed Terminal</div>
                <div className="terminal-panel__hint">
                  現在のセッション: {currentSessionLabel} {connectionStatus === "connected" ? " / 直接入力できます" : ""}
                </div>
              </div>
              <div className="terminal-panel__actions">
                <button
                  type="button"
                  className="debug-panel__btn debug-panel__btn--secondary"
                  onClick={clearTerminal}
                >
                  クリア
                </button>
                <button
                  type="button"
                  className="debug-panel__btn debug-panel__btn--secondary"
                  onClick={() => sendTerminalInput("\u0003")}
                >
                  Ctrl+C
                </button>
              </div>
            </div>
            <Suspense
              fallback={<div className="terminal-panel__screen terminal-panel__screen--xterm" role="presentation" />}
            >
              <TerminalPane
                ref={terminalPaneRef}
                className="terminal-panel__screen terminal-panel__screen--xterm"
                onData={sendTerminalInput}
                onPendingOutputFlushed={handlePendingTerminalOutputFlushed}
                pendingOutput={pendingTerminalOutput}
                theme={terminalTheme}
              />
            </Suspense>
          </div>

          <div className="panel workspace-subpanel">
            <ProfileSelector
              profiles={profiles}
              activeId={activeProfileId}
              disabled={connectionStatus !== "connected"}
              onSelect={handleSelectProfile}
              onEdit={handleEditProfile}
              onCreate={handleCreateProfile}
              onDelete={handleDeleteProfile}
            />
            {connectionStatus !== "connected" && (
              <div className="hint-text">サーバー未接続のためプロファイル操作は無効です</div>
            )}
          </div>
        </div>

        <div className="workspace-column workspace-column--right">
          <div className="panel commentary-panel">
            <div className="commentary-panel__header">
              <div>
                <div className="commentary-panel__title">実況と解説</div>
                <div className="commentary-panel__hint">現在の CLI 出力を整理して右側に表示します。</div>
              </div>
              <div className="commentary-panel__status">Ruleset: {sourceLabel}</div>
            </div>

            <div className="control-row">
              <label className="control-row__label">口調：</label>
              <select value={style} onChange={(e) => sendStyle(e.target.value as Style)}>
                <option value="standard">標準</option>
                <option value="kansai">関西弁</option>
                <option value="zundamon">ずんだもん風（テキスト）</option>
              </select>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--color-fg-tertiary)" }}>（イベント時＋最大2秒に1回）</span>
            </div>

            <div className="control-row">
              <label className="control-row__label">表示：</label>
              <select
                value={commentaryDisplayMode}
                onChange={(e) => setCommentaryDisplayMode(e.target.value as CommentaryDisplayMode)}
              >
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
                  onChange={(e) => handleTTSToggle(e.target.checked)}
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
              {!ttsSupported && (
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-danger)" }}>
                  ※ このブラウザはTTS非対応です
                </span>
              )}
            </div>

            {ttsSupported && ttsEnabled && ttsSettingsOpen && (
              <div className="tts-settings">
                <div className="tts-settings__field">
                  <label className="tts-settings__label">プリセット:</label>
                  <select
                    value={ttsPresetValue}
                    onChange={(e) => handleTTSPresetChange(e.target.value as TTSPresetSelectValue)}
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
                      value={ttsSettings.voiceURI ?? ""}
                      onChange={(e) =>
                        handleTTSSettingsChange({
                          ...ttsSettings,
                          voiceURI: e.target.value || null,
                        })
                      }
                      style={{ width: "100%", padding: "var(--space-1)" }}
                    >
                      <option value="">デフォルト</option>
                      {voices.map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name} ({v.lang})
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
                  <label className="tts-settings__label">速度: {ttsSettings.rate.toFixed(1)}</label>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={ttsSettings.rate}
                    onChange={(e) =>
                      handleTTSSettingsChange({
                        ...ttsSettings,
                        rate: parseFloat(e.target.value),
                      })
                    }
                    style={{ width: "100%" }}
                  />
                  <div className="tts-settings__range-labels">
                    <span>遅い (0.5)</span>
                    <span>速い (2.0)</span>
                  </div>
                </div>

                <div className="tts-settings__field">
                  <label className="tts-settings__label">音程: {ttsSettings.pitch.toFixed(1)}</label>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={ttsSettings.pitch}
                    onChange={(e) =>
                      handleTTSSettingsChange({
                        ...ttsSettings,
                        pitch: parseFloat(e.target.value),
                      })
                    }
                    style={{ width: "100%" }}
                  />
                  <div className="tts-settings__range-labels">
                    <span>低い (0.5)</span>
                    <span>高い (2.0)</span>
                  </div>
                </div>

                <div className="tts-settings__field">
                  <label className="tts-settings__label">音量: {Math.round(ttsSettings.volume * 100)}%</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={ttsSettings.volume}
                    onChange={(e) =>
                      handleTTSSettingsChange({
                        ...ttsSettings,
                        volume: parseFloat(e.target.value),
                      })
                    }
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
                      checked={ttsSettings.includeRawDetail}
                      onChange={(e) =>
                        handleTTSSettingsChange({
                          ...ttsSettings,
                          includeRawDetail: e.target.checked,
                        })
                      }
                    />
                    <span>原文も読む</span>
                  </label>
                  <div className="tts-settings__helper">
                    オフ: 実況中心で短く読みます。オン: 検出した原文も続けて読みます。
                  </div>
                </div>

                <div className="tts-settings__actions">
                  <button onClick={handleTestSpeak} className="btn-primary">
                    テスト読み上げ
                  </button>
                  <button onClick={() => handleTTSSettingsChange(DEFAULT_TTS_SETTINGS)} className="btn-secondary">
                    リセット
                  </button>
                </div>
              </div>
            )}

            <div className="log-toolbar panel">
              <div className="log-toolbar__controls">
                <input
                  className="log-toolbar__search"
                  type="text"
                  value={logQuery}
                  onChange={(e) => setLogQuery(e.target.value)}
                  placeholder="ログを検索（本文/詳細/種別）"
                />
                <select
                  className="log-toolbar__type"
                  value={logEventType}
                  onChange={(e) => setLogEventType(e.target.value as LogEventTypeFilter)}
                >
                  {EVENT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="log-toolbar__meta">
                {filteredItems.length} / {items.length} 件
                {groupedItems.length !== filteredItems.length && `（表示 ${groupedItems.length} カード）`}
              </div>
            </div>

            <div ref={logContainerRef} className="log-container" onScroll={handleLogScroll}>
              {filteredItems.length === 0 ? (
                <div className="log-empty">条件に一致するログはありません。</div>
              ) : (
                groupedItems.map((group, idx) => {
            const it = group.latest;
            const parts = getCommentaryTextParts({
              narration: it.narration,
              explanation: it.explanation,
              glossaryNotes: it.glossaryNotes,
            });
            const notes = parts.glossaryNotes;
            const detailEntries = unique(group.items.map((entry) => entry.detail));
            const summaryEntries = unique(
              group.items
                .map((entry) => entry.summary)
                .filter((entry) => entry && !GENERIC_LOG_SUMMARIES.has(entry))
            );
            const detailPreview = detailEntries.slice(-GROUP_DETAIL_PREVIEW_COUNT);
            const hiddenDetailCount = Math.max(0, detailEntries.length - detailPreview.length);
            const isGrouped = group.count > 1;
            const latestSummary = summaryEntries.at(-1);
            const hasUsefulSummary = summaryEntries.length > 0;
            const groupHint = isGrouped
              ? `同じ流れのログが ${group.count} 件続いたので、最新の内容を代表で見せています。`
              : null;
            const showNarration = commentaryDisplayMode !== "explanation" && Boolean(parts.narrationText);
            const showExplanation = commentaryDisplayMode !== "narration" && Boolean(parts.explanationText);
            const primaryText = showNarration ? parts.narrationText : showExplanation ? parts.explanationText : null;
            const showExplanationBody = showNarration && showExplanation;

            return (
                  <div key={`${group.key}-${idx}`} className="log-item">
                    <div className="log-item__header">
                      <div className="log-item__time">{formatLogTimeRange(group.startTs, group.endTs)}</div>
                      <div className="log-item__header-meta">
                        <div className="log-item__type">{EVENT_TYPE_LABELS[it.eventType]}</div>
                        {isGrouped && <div className="log-item__group-badge">{group.count}件まとめ</div>}
                      </div>
                    </div>
                    {primaryText && <div className="log-item__text">{primaryText}</div>}
                    {(groupHint || showExplanationBody || notes.length > 0) && (
                      <div className="log-item__explain">
                        {groupHint && (
                          <div className="log-item__explain-body">
                            <div className="log-item__section-label">まとめ表示</div>
                            <div className="log-item__explain-text">{groupHint}</div>
                          </div>
                        )}
                        {showExplanationBody && parts.explanationText && (
                          <div className="log-item__explain-body">
                            <div className="log-item__section-label">やさしい説明</div>
                            <div className="log-item__explain-text">{parts.explanationText}</div>
                          </div>
                        )}
                        {notes.length > 0 && (
                          <div className="log-item__note-block" aria-label="用語注釈">
                            <div className="log-item__section-label">用語補足</div>
                            <div className="log-item__note">
                              {notes.map((note) => (
                                <span key={note} className="log-item__note-chip">
                                  {note}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {(hasUsefulSummary || detailPreview.length > 0) && (
                      <div className="log-item__raw">
                        {hasUsefulSummary && (
                          <div className="log-item__meta-row">
                            <div className="log-item__section-label">検出イベント</div>
                            {summaryEntries.length === 1 ? (
                              <div className="log-item__summary">{latestSummary}</div>
                            ) : (
                              <div className="log-item__summary-list">
                                {summaryEntries.map((entry) => (
                                  <div key={entry} className="log-item__summary">
                                    {entry}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {detailPreview.length > 0 && (
                          <div className="log-item__meta-row">
                            <div className="log-item__section-label">{isGrouped ? "原文プレビュー" : "原文"}</div>
                            <div className="log-item__detail-stack">
                              {detailPreview.map((entry, previewIndex) => (
                                <pre key={`${group.key}-detail-${previewIndex}`} className="log-item__detail">
                                  {entry}
                                </pre>
                              ))}
                            </div>
                            {hiddenDetailCount > 0 && (
                              <div className="log-item__detail-more">さらに {hiddenDetailCount} 件の近いログがあります。</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            </div>
          </div>
        </div>
      </div>

      {/* Profile Editor Modal */}
      {editingProfile === "loading" && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2 className="modal__title">プロファイルを読み込み中...</h2>
            <div className="form-actions">
              <button type="button" onClick={handleCancelEdit}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
      {editingProfile && editingProfile !== "loading" && (
        <Suspense
          fallback={
            <div className="modal-backdrop">
              <div className="modal">
                <h2 className="modal__title">プロファイルエディターを読み込み中...</h2>
                <div className="form-actions">
                  <button type="button" onClick={handleCancelEdit}>
                    キャンセル
                  </button>
                </div>
              </div>
            </div>
          }
        >
          <ProfileEditor
            key={profileEditorKey}
            profile={editingProfile === "new" ? null : editingProfile}
            error={profileError}
            isWsOpen={connectionStatus === "connected"}
            onSave={handleSaveProfile}
            onCancel={handleCancelEdit}
          />
        </Suspense>
      )}
    </div>
  );
}
