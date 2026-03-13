import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import "xterm/css/xterm.css";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { ProfileSelector } from "./components/ProfileSelector";
import { ProfileEditor } from "./components/ProfileEditor";
import {
  isTTSSupported,
  speak,
  stopSpeech,
  getTTSEnabled,
  setTTSEnabled,
  getTTSSettings,
  setTTSSettings,
  waitForVoices,
  TTS_PRESETS,
  DEFAULT_TTS_SETTINGS,
  applyTTSPreset,
  detectTTSPreset,
  type TTSPresetId,
  type TTSSettings,
} from "./lib/tts";
import { getDesktopFailureGuidance, type DesktopServerState } from "./lib/recovery";
import {
  EVENT_TYPE_LABELS,
  EVENT_TYPE_OPTIONS,
  filterCommentaryItems,
  getCommentaryGroupKey,
  groupCommentaryItems,
  isEventType,
  type CommentaryItem,
  type LogEventTypeFilter,
} from "./lib/log-filter";
import { buildSpeechText, getCommentaryTextParts } from "./lib/glossary-note";
import {
  LAUNCH_PRESETS,
  buildLaunchDraft,
  buildLaunchSessionInput,
  type LaunchDraft,
  type LaunchPresetId,
} from "./lib/session-launcher";
import type {
  CommentaryDisplayMode,
  Style,
  SourceState,
  Profile,
  ProfileSummary,
  CreateProfileInput,
  InputMode,
  ServerToClientMessage,
  PtyUnavailablePayload,
} from "./types";

export type Skin = "standard" | "cli";

type LegacyHello = { type: "hello"; style: Style };
type PayloadMessage = { type?: string; payload?: PtyUnavailablePayload | Record<string, unknown> };
type TTSPresetSelectValue = TTSPresetId | "custom";

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting";
const LOG_AUTO_SCROLL_THRESHOLD_PX = 64;
const GENERIC_LOG_SUMMARIES = new Set(["ログ更新"]);
const GROUP_DETAIL_PREVIEW_COUNT = 3;
const TERMINAL_OUTPUT_MAX_CHARS = 24000;
const TTS_BATCH_DELAY_MS = 900;
const COMMENTARY_DISPLAY_MODE_OPTIONS: Array<{ value: CommentaryDisplayMode; label: string }> = [
  { value: "both", label: "実況＋解説" },
  { value: "narration", label: "実況のみ" },
  { value: "explanation", label: "解説のみ" },
];

function isSkin(value: string | null): value is Skin {
  return value === "standard" || value === "cli";
}

function getTerminalTheme(skin: Skin) {
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

type ServerStatusDetail = {
  state: DesktopServerState;
  pid: number | null;
  started_at: number | null;
  transitioned_at: number | null;
  error: string | null;
  health_ok: boolean;
  last_seen_at: number | null;
  port: number;
};

type UpdaterCheckStatus = {
  configured: boolean;
  available: boolean;
  currentVersion: string;
  version: string | null;
  date: string | null;
  body: string | null;
  error: string | null;
};

type PendingSpeechBatch = {
  groupKey: string | null;
  latest: CommentaryItem;
  count: number;
};

type TauriCore = { invoke: (cmd: string) => Promise<unknown> };

const getTauriCore = (): TauriCore | undefined => {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { __TAURI__?: { core?: TauriCore } }).__TAURI__?.core;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getPayloadRecord = (msg: unknown): Record<string, unknown> | null => {
  if (!isRecord(msg) || !("payload" in msg)) return null;
  const payload = (msg as { payload?: unknown }).payload;
  return isRecord(payload) ? payload : null;
};

const getStringField = (obj: Record<string, unknown> | null, key: string): string | undefined => {
  if (!obj) return undefined;
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
};

const getStringArrayField = (obj: Record<string, unknown> | null, key: string): string[] | undefined => {
  if (!obj) return undefined;
  const value = obj[key];
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
};

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

const errorToMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "toString" in error) return String(error);
  return "Unknown error";
};

const DESKTOP_STATE_LABEL: Record<DesktopServerState, string> = {
  stopped: "停止中",
  starting: "起動中",
  running: "稼働中",
  stopping: "停止処理中",
  failed: "失敗",
};

const copyWithFallback = async (text: string): Promise<boolean> => {
  if (navigator?.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy copy
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
};

function stubProfileFromSummary(summary: ProfileSummary): Profile {
  return {
    id: summary.id,
    name: summary.name,
    cmd: summary.cmd,
    args: [],
    style: "kansai",
    logSource: "auto",
    inputMode: "pty",
    createdAt: 0,
    updatedAt: 0,
  };
}

type TauriStatusPanelProps = {
  onStatusChange?: (status: ServerStatusDetail | null) => void;
};

// Desktop server control panel (shown only in Tauri runtime)
function TauriStatusPanel({ onStatusChange }: TauriStatusPanelProps) {
  const isTauri = Boolean(getTauriCore());
  const [status, setStatus] = useState<ServerStatusDetail | null>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [autostartEnabled, setAutostartEnabled] = useState<boolean | null>(null);
  const [autostartLoading, setAutostartLoading] = useState(false);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterCheckStatus | null>(null);
  const [updaterLoading, setUpdaterLoading] = useState(false);
  const [copiedRecoveryCommand, setCopiedRecoveryCommand] = useState<string | null>(null);

  // Polling (1.5 second interval)
  useEffect(() => {
    if (!isTauri) {
      onStatusChange?.(null);
      return;
    }
    let cancelled = false;

    const poll = async () => {
      const core = getTauriCore();
      if (!core) return;
      try {
        const result = await core.invoke("server_status");
        if (cancelled) return;
        const nextStatus = result as ServerStatusDetail;
        setStatus(nextStatus);
        onStatusChange?.(nextStatus);
        setInvokeError(null);
      } catch (err) {
        if (cancelled) return;
        setInvokeError(errorToMessage(err));
      }
    };

    poll(); // Initial immediate call
    const interval = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isTauri, onStatusChange]);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;

    const fetchAutostart = async () => {
      const core = getTauriCore();
      if (!core) return;
      try {
        const result = await core.invoke("autostart_status");
        if (cancelled) return;
        setAutostartEnabled(Boolean(result));
      } catch (err) {
        if (cancelled) return;
        setInvokeError(errorToMessage(err));
      }
    };

    fetchAutostart();
    return () => {
      cancelled = true;
    };
  }, [isTauri]);

  if (!isTauri) return null;

  const state: DesktopServerState = status?.state ?? "stopped";

  const handleStart = async () => {
    const core = getTauriCore();
    if (!core) return;
    try {
      const result = await core.invoke("server_start");
      const nextStatus = result as ServerStatusDetail;
      setStatus(nextStatus);
      onStatusChange?.(nextStatus);
      setInvokeError(null);
    } catch (err) {
      setInvokeError(errorToMessage(err));
    }
  };

  const handleStop = async () => {
    const core = getTauriCore();
    if (!core) return;
    try {
      const result = await core.invoke("server_stop");
      const nextStatus = result as ServerStatusDetail;
      setStatus(nextStatus);
      onStatusChange?.(nextStatus);
      setInvokeError(null);
    } catch (err) {
      setInvokeError(errorToMessage(err));
    }
  };

  const handleToggleAutostart = async () => {
    const core = getTauriCore();
    if (!core || autostartEnabled === null) return;
    setAutostartLoading(true);
    try {
      const command = autostartEnabled ? "autostart_disable" : "autostart_enable";
      const result = await core.invoke(command);
      setAutostartEnabled(Boolean(result));
      setInvokeError(null);
    } catch (err) {
      setInvokeError(errorToMessage(err));
    } finally {
      setAutostartLoading(false);
    }
  };

  const handleCheckUpdater = async () => {
    const core = getTauriCore();
    if (!core) return;
    setUpdaterLoading(true);
    try {
      const result = await core.invoke("updater_check");
      setUpdaterStatus(result as UpdaterCheckStatus);
      setInvokeError(null);
    } catch (err) {
      setInvokeError(errorToMessage(err));
    } finally {
      setUpdaterLoading(false);
    }
  };

  const getStateColor = (value: DesktopServerState) => {
    if (value === "running") return "var(--color-success)";
    if (value === "failed") return "var(--color-danger)";
    if (value === "starting" || value === "stopping") return "var(--color-warning)";
    return "var(--color-fg-secondary)";
  };

  const stateMessage = (() => {
    if (state === "starting") return "サーバー起動処理中です。完了まで数秒待ってください。";
    if (state === "running") return "サーバーは稼働中です。実況UIが接続されます。";
    if (state === "stopping") return "サーバー停止処理中です。";
    if (state === "failed") return "起動に失敗しました。原因を解消して Start を再試行してください。";
    return "サーバーは停止しています。Start で起動できます。";
  })();

  const failureGuidance = getDesktopFailureGuidance(state, status?.error ?? null, invokeError);

  const startDisabled = state === "starting" || state === "running" || state === "stopping";
  const stopDisabled = state === "stopped" || state === "stopping" || state === "failed";
  const startLabel = state === "failed" ? "Retry Start" : "Start";
  const autostartLabel = autostartEnabled === null ? "確認中" : autostartEnabled ? "有効" : "無効";
  const autostartButtonLabel =
    autostartEnabled === null ? "読み込み中..." : autostartEnabled ? "自動起動を無効化" : "自動起動を有効化";
  const autostartButtonDisabled = autostartLoading || autostartEnabled === null;
  const updaterLabel = (() => {
    if (updaterLoading) return "確認中";
    if (!updaterStatus) return "未確認";
    if (!updaterStatus.configured) return "未設定";
    if (updaterStatus.available) return `更新あり (v${updaterStatus.version ?? "?"})`;
    return "最新";
  })();
  const updaterNotice = (() => {
    if (!updaterStatus) return null;
    if (updaterStatus.error) {
      return {
        text: updaterStatus.error,
        className: "debug-panel__alert--crash",
      };
    }
    if (updaterStatus.available) {
      const details = [
        `新しいバージョン v${updaterStatus.version ?? "?"} が利用可能です。`,
        updaterStatus.date ? `公開日: ${updaterStatus.date}` : "",
        updaterStatus.body?.trim() ? `内容: ${updaterStatus.body.trim()}` : "",
      ].filter(Boolean);
      return {
        text: details.join("\n"),
        className: "debug-panel__alert--warning",
      };
    }
    return null;
  })();
  const updaterMeta =
    updaterStatus && updaterStatus.configured && !updaterStatus.available && !updaterStatus.error
      ? `現在のバージョン v${updaterStatus.currentVersion} は最新です。`
      : null;

  const handleCopyRecoveryCommand = async (command: string) => {
    const copied = await copyWithFallback(command);
    if (!copied) {
      setInvokeError("復旧コマンドのコピーに失敗しました。");
      return;
    }
    setCopiedRecoveryCommand(command);
    window.setTimeout(() => {
      setCopiedRecoveryCommand((current) => (current === command ? null : current));
    }, 1600);
  };

  return (
    <div className="debug-panel">
      <div className="debug-panel__title">Desktop Server</div>
      <p className="debug-panel__hint">{stateMessage}</p>

      {status && (
        <div className="debug-panel__status">
          <div className="debug-panel__row">
            <span className="debug-panel__label">State</span>
            <span className="debug-panel__badge" style={{ color: getStateColor(state) }}>
              {DESKTOP_STATE_LABEL[state]}
            </span>
          </div>
          <div className="debug-panel__row">
            <span className="debug-panel__label">Health</span>
            <span style={{ color: status.health_ok ? "var(--color-success)" : "var(--color-danger)" }}>
              {status.health_ok ? "OK" : "NG"}
            </span>
          </div>
          <div className="debug-panel__row">
            <span className="debug-panel__label">PID</span>
            <span>{status.pid ?? "-"}</span>
          </div>
          <div className="debug-panel__row">
            <span className="debug-panel__label">Port</span>
            <span>{status.port}</span>
          </div>
          <div className="debug-panel__row">
            <span className="debug-panel__label">Auto-start</span>
            <span>{autostartLabel}</span>
          </div>
          <div className="debug-panel__row">
            <span className="debug-panel__label">Updater</span>
            <span>{updaterLabel}</span>
          </div>
          {status.transitioned_at && (
            <div className="debug-panel__meta">
              状態更新: {new Date(status.transitioned_at).toLocaleTimeString()}
            </div>
          )}
          {status.started_at && (
            <div className="debug-panel__meta">
              起動時刻: {new Date(status.started_at).toLocaleTimeString()}
            </div>
          )}
          {status.last_seen_at && (
            <div className="debug-panel__meta">
              最終ヘルス応答: {new Date(status.last_seen_at).toLocaleTimeString()}
            </div>
          )}
          {status.error && (
            <div className="debug-panel__alert debug-panel__alert--crash">{status.error}</div>
          )}
        </div>
      )}
      {invokeError && (
        <div className="debug-panel__alert debug-panel__alert--warning">{invokeError}</div>
      )}
      {updaterMeta && <div className="debug-panel__meta">{updaterMeta}</div>}
      {updaterNotice && (
        <div className={`debug-panel__alert ${updaterNotice.className}`}>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{updaterNotice.text}</pre>
        </div>
      )}
      {failureGuidance && (
        <section className="debug-panel__recovery-card" aria-label="startup recovery guidance">
          <div className="debug-panel__recovery-header">
            <div className="debug-panel__meta">想定原因: {failureGuidance.category}</div>
            <div className="debug-panel__recovery-summary">{failureGuidance.summary}</div>
          </div>
          <div className="debug-panel__recovery-primary">
            <span className="debug-panel__recovery-label">最初のアクション</span>
            <p>{failureGuidance.primaryAction}</p>
          </div>
          {failureGuidance.hints.length > 0 && (
            <div className="debug-panel__recovery-section">
              <span className="debug-panel__recovery-label">確認ポイント</span>
              <ul className="debug-panel__recovery">
                {failureGuidance.hints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            </div>
          )}
          {failureGuidance.diagnostics.length > 0 && (
            <div className="debug-panel__recovery-section">
              <span className="debug-panel__recovery-label">診断情報</span>
              <ul className="debug-panel__diagnostics">
                {failureGuidance.diagnostics.map((diagnostic) => (
                  <li key={diagnostic}>
                    <code>{diagnostic}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {failureGuidance.commands.length > 0 && (
            <div className="debug-panel__recovery-section">
              <span className="debug-panel__recovery-label">試すコマンド</span>
              <div className="debug-panel__command-list">
                {failureGuidance.commands.map((command) => (
                  <div className="debug-panel__command" key={command.command}>
                    <div className="debug-panel__command-meta">{command.label}</div>
                    <code className="debug-panel__command-code">{command.command}</code>
                    <button
                      type="button"
                      className="debug-panel__copy-btn"
                      onClick={() => {
                        void handleCopyRecoveryCommand(command.command);
                      }}
                    >
                      {copiedRecoveryCommand === command.command ? "Copied" : "Copy"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <div className="debug-panel__actions">
        <button className="debug-panel__btn debug-panel__btn--primary" onClick={handleStart} disabled={startDisabled}>
          {startLabel}
        </button>
        <button className="debug-panel__btn debug-panel__btn--secondary" onClick={handleStop} disabled={stopDisabled}>
          Stop
        </button>
      </div>
      <div className="debug-panel__actions">
        <button
          className="debug-panel__btn debug-panel__btn--secondary"
          onClick={handleToggleAutostart}
          disabled={autostartButtonDisabled}
        >
          {autostartLoading ? "更新中..." : autostartButtonLabel}
        </button>
      </div>
      <div className="debug-panel__actions">
        <button className="debug-panel__btn debug-panel__btn--secondary" onClick={handleCheckUpdater} disabled={updaterLoading}>
          {updaterLoading ? "確認中..." : "更新を確認"}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const isTauriRuntime = Boolean(getTauriCore());
  const [items, setItems] = useState<CommentaryItem[]>([]);
  const [logQuery, setLogQuery] = useState("");
  const [logEventType, setLogEventType] = useState<LogEventTypeFilter>("all");
  const [style, setStyle] = useState<Style>("kansai");
  const [source, setSource] = useState<SourceState>({ mode: "auto", detected: null });
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
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
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEditIdRef = useRef<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalBacklogRef = useRef("");
  const shouldStickLogRef = useRef(true);

  // Profile state
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<Profile | null | "new" | "loading">(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const profilesRef = useRef<ProfileSummary[]>([]);

  // PTY unavailable state (when node-pty build fails)
  const [ptyUnavailable, setPtyUnavailable] = useState<{
    error?: string;
    suggestion?: string;
    receivedAt: number;
  } | null>(null);
  const [ptyError, setPtyError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // TTS state
  const [ttsEnabled, setTtsEnabledState] = useState(() => getTTSEnabled());
  const [ttsSettings, setTtsSettingsState] = useState<TTSSettings>(() => getTTSSettings());
  const [ttsSettingsOpen, setTtsSettingsOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const ttsSupported = isTTSSupported();
  const ttsEnabledRef = useRef(ttsEnabled);
  const ttsSettingsRef = useRef(ttsSettings);
  const pendingSpeechRef = useRef<PendingSpeechBatch | null>(null);
  const pendingSpeechTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const sendTerminalInput = useCallback((data: string) => {
    if (!data) return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setPtyError("サーバーに接続されていません");
      return;
    }
    wsRef.current.send(JSON.stringify({ kind: "writeInput", data }));
  }, []);

  // Apply skin to document
  useEffect(() => {
    document.documentElement.setAttribute("data-skin", skin);
    localStorage.setItem("cli-commentator-skin", skin);
  }, [skin]);

  useEffect(() => {
    localStorage.setItem("cli-commentator-display-mode", commentaryDisplayMode);
  }, [commentaryDisplayMode]);

  // TTS ref sync (to avoid stale closure in WebSocket handler)
  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
  }, [ttsEnabled]);

  useEffect(() => {
    ttsSettingsRef.current = ttsSettings;
  }, [ttsSettings]);

  // Profile ref sync (to avoid stale closure in WebSocket handler)
  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  // Load available voices
  useEffect(() => {
    if (!ttsSupported) return;
    waitForVoices().then((v) => {
      setVoices(v);
      setVoicesLoaded(true);
    });
  }, [ttsSupported]);

  useEffect(() => {
    const host = terminalContainerRef.current;
    if (!host || terminalRef.current) return;
    let disposed = false;
    let frameId: number | null = null;

    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "var(--font-mono)",
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: getTerminalTheme(skin),
    });

    terminal.loadAddon(fitAddon);
    terminal.open(host);
    const scheduleFit = () => {
      if (disposed) return;
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        if (disposed) return;
        try {
          fitAddon.fit();
          terminal.focus();
        } catch (error) {
          if (import.meta.env.DEV) {
            console.debug("xterm fit skipped", error);
          }
        }
      });
    };

    scheduleFit();
    terminal.onData((data) => {
      sendTerminalInput(data);
    });

    if (terminalBacklogRef.current) {
      terminal.write(terminalBacklogRef.current);
      terminalBacklogRef.current = "";
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            scheduleFit();
          })
        : null;
    resizeObserver?.observe(host);

    return () => {
      disposed = true;
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sendTerminalInput, skin]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = getTerminalTheme(skin);
    fitAddonRef.current?.fit();
  }, [skin]);

  // TTS cleanup on unmount (prevent orphan speech on reload/navigation)
  useEffect(() => {
    return () => {
      if (pendingSpeechTimeoutRef.current) {
        clearTimeout(pendingSpeechTimeoutRef.current);
        pendingSpeechTimeoutRef.current = null;
      }
      pendingSpeechRef.current = null;
      stopSpeech();
    };
  }, []);

  const clearPendingSpeech = useCallback(() => {
    if (pendingSpeechTimeoutRef.current) {
      clearTimeout(pendingSpeechTimeoutRef.current);
      pendingSpeechTimeoutRef.current = null;
    }
    pendingSpeechRef.current = null;
  }, []);

  const flushPendingSpeech = useCallback(() => {
    if (pendingSpeechTimeoutRef.current) {
      clearTimeout(pendingSpeechTimeoutRef.current);
      pendingSpeechTimeoutRef.current = null;
    }

    const pending = pendingSpeechRef.current;
    pendingSpeechRef.current = null;
    if (!pending || !ttsEnabledRef.current) return;

    const rawDetail = ttsSettingsRef.current.includeRawDetail ? normalizeSuggestion(pending.latest.detail) : undefined;
    const speechText = buildSpeechText(
      getCommentaryTextParts({
        narration: pending.latest.narration,
        explanation: pending.latest.explanation,
        glossaryNotes: pending.latest.glossaryNotes,
      }),
      pending.count,
      rawDetail,
      commentaryDisplayMode
    );
    if (!speechText) return;
    speak(speechText, ttsSettingsRef.current);
  }, [commentaryDisplayMode]);

  const schedulePendingSpeech = useCallback(() => {
    if (pendingSpeechTimeoutRef.current) {
      clearTimeout(pendingSpeechTimeoutRef.current);
    }
    pendingSpeechTimeoutRef.current = setTimeout(() => {
      flushPendingSpeech();
    }, TTS_BATCH_DELAY_MS);
  }, [flushPendingSpeech]);

  const queueSpeech = useCallback((item: CommentaryItem) => {
    if (!ttsEnabledRef.current) return;

    const groupKey = getCommentaryGroupKey(item);
    const pending = pendingSpeechRef.current;
    if (pending && groupKey && pending.groupKey === groupKey) {
      pending.latest = item;
      pending.count += 1;
      schedulePendingSpeech();
      return;
    }

    if (pending) {
      flushPendingSpeech();
    }

    pendingSpeechRef.current = {
      groupKey,
      latest: item,
      count: 1,
    };
    schedulePendingSpeech();
  }, [flushPendingSpeech, schedulePendingSpeech]);

  // Copy feedback cleanup/reset
  useEffect(() => {
    return () => {
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current);
      }
    };
  }, []);

  const handleTTSToggle = (enabled: boolean) => {
    setTtsEnabledState(enabled);
    setTTSEnabled(enabled);
    if (enabled) {
      // Safari対策: ユーザー操作をトリガーに一言喋らせる
      speak("読み上げを開始します", ttsSettings);
    } else {
      clearPendingSpeech();
      stopSpeech();
      setTtsSettingsOpen(false);
    }
  };

  const handleTTSSettingsChange = (newSettings: TTSSettings) => {
    setTtsSettingsState(newSettings);
    setTTSSettings(newSettings);
  };

  const writeToTerminal = useCallback((data: string) => {
    if (!data) return;
    const terminal = terminalRef.current;
    if (!terminal) {
      terminalBacklogRef.current += data;
      if (terminalBacklogRef.current.length > TERMINAL_OUTPUT_MAX_CHARS) {
        terminalBacklogRef.current = terminalBacklogRef.current.slice(-TERMINAL_OUTPUT_MAX_CHARS);
      }
      return;
    }
    terminal.write(data);
  }, []);

  const clearTerminal = useCallback(() => {
    terminalBacklogRef.current = "";
    terminalRef.current?.clear();
  }, []);

  const handleTTSPresetChange = (presetId: TTSPresetSelectValue) => {
    if (presetId === "custom") return;
    handleTTSSettingsChange(applyTTSPreset(ttsSettings, presetId));
  };

  const handleTestSpeak = () => {
    speak("これはテスト読み上げです。設定を確認してください。", ttsSettings);
  };

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

  useEffect(() => {
    // D-1: Prevent ghost reconnection on unmount/hot-reload
    let cancelled = false;

    // Exponential backoff: 500ms, 1s, 2s, 4s, 8s, max 10s
    const getReconnectDelay = (attempt: number): number => {
      const baseDelay = 500;
      const maxDelay = 10000;
      return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    };

    const connect = () => {
      if (cancelled) return;

      // Clear any existing reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      setConnectionStatus(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled || wsRef.current !== ws) return;
        console.log("WebSocket connected");
        setConnectionStatus("connected");
        setProfileError(null); // Clear WS offline error on reconnect
        reconnectAttemptRef.current = 0;
      };

      ws.onmessage = (e) => {
        if (cancelled || wsRef.current !== ws) return;
        try {
          const msg = JSON.parse(e.data) as ServerToClientMessage | LegacyHello | PayloadMessage;
          const kind = "kind" in msg ? msg.kind : msg.type;
          const payload = getPayloadRecord(msg);
          const data = (payload ?? msg) as Record<string, unknown>;
          switch (kind) {
            case "hello":
              if (typeof data.style === "string") setStyle(data.style as Style);
              if (data.source) setSource(data.source as SourceState);
              break;
            case "style":
              if (typeof data.style === "string") setStyle(data.style as Style);
              break;
            case "source":
              if (data.source) setSource(data.source as SourceState);
              break;
            case "raw":
              if (typeof data.data === "string") {
                writeToTerminal(data.data);
              }
              break;
            case "commentary":
              if (typeof data.ts === "number") {
                const ev = isRecord(data.ev) ? data.ev : null;
                const eventTypeCandidate = ev?.type;
                const eventType = isEventType(eventTypeCandidate) ? eventTypeCandidate : "stdout";
                const summary = typeof ev?.summary === "string" ? ev.summary : undefined;
                const detail = typeof ev?.detail === "string" ? ev.detail : undefined;
                const parts = getCommentaryTextParts({
                  narration: getStringField(data, "narration"),
                  explanation: getStringField(data, "explanation"),
                  glossaryNotes: getStringArrayField(data, "glossaryNotes"),
                  text: getStringField(data, "text"),
                });
                if (!parts.narrationText && !parts.explanationText && parts.glossaryNotes.length === 0) {
                  break;
                }
                const nextItem: CommentaryItem = {
                  ts: data.ts as number,
                  narration: parts.narrationText ?? undefined,
                  explanation: parts.explanationText ?? undefined,
                  glossaryNotes: parts.glossaryNotes,
                  eventType,
                  summary,
                  detail,
                };
                setItems((prev) => [...prev, nextItem].slice(-200));
                queueSpeech(nextItem);
              }
              break;
            case "profiles":
              if (Array.isArray(data.profiles)) {
                setProfiles(data.profiles as ProfileSummary[]);
                if ("activeId" in data) {
                  setActiveProfileId((data.activeId as string | null) ?? null);
                }
              }
              break;
            case "profileSaved":
              if (data.profile) {
                const profile = data.profile as ProfileSummary;
                setProfiles((prev) => {
                  const exists = prev.some((p) => p.id === profile.id);
                  if (exists) {
                    return prev.map((p) => (p.id === profile.id ? profile : p));
                  }
                  return [...prev, profile];
                });
                if ("activeId" in data) {
                  setActiveProfileId((data.activeId as string | null) ?? null);
                }
                setEditingProfile(null);
                setProfileError(null);
              }
              break;
            case "profileDeleted":
              if (typeof data.id === "string") {
                setProfiles((prev) => prev.filter((p) => p.id !== data.id));
                if ("activeId" in data) {
                  setActiveProfileId((data.activeId as string | null) ?? null);
                }
              }
              break;
            case "profileDetail":
              if (data.profile) {
                const profile = data.profile as Profile;
                // Verify this is the response for the pending edit request
                if (pendingEditIdRef.current === profile.id) {
                  setEditingProfile(profile);
                  pendingEditIdRef.current = null;
                }
              }
              break;
            case "profileError":
              if (typeof data.error === "string") {
                setProfileError(data.error);
                // If a profile detail fetch was pending, fall back to summary data
                const pid = pendingEditIdRef.current;
                if (pid) {
                  pendingEditIdRef.current = null;
                  const summary = profilesRef.current.find((p) => p.id === pid);
                  if (summary) {
                    setEditingProfile(stubProfileFromSummary(summary));
                  } else {
                    setEditingProfile(null);
                  }
                }
              }
              break;
            case "ptyRestart":
              // Clear commentary items when PTY restarts
              setItems([]);
              clearTerminal();
              clearPendingSpeech();
              stopSpeech();
              setProfileError(null);
              setPtyError(null);
              setCurrentSessionLabel(
                [typeof data.cmd === "string" ? data.cmd : "", ...(Array.isArray(data.args) ? (data.args as string[]) : [])]
                  .filter(Boolean)
                  .join(" ") || "session"
              );
              break;
            case "ptyError":
              if (typeof data.error === "string") {
                setPtyError(data.error);
              }
              break;
            case "ptyUnavailable":
              setCopyState("idle");
              setPtyUnavailable({
                error: normalizeSuggestion(getStringField(data, "error")),
                suggestion: normalizeSuggestion(getStringField(data, "suggestion")),
                receivedAt: Date.now(),
              });
              break;
            default:
              break;
          }
        } catch (err) {
          if (import.meta.env.DEV) {
            console.debug("Ignored malformed WebSocket message", err);
          }
        }
      };

      ws.onerror = (error) => {
        if (wsRef.current !== ws) return;
        console.error("WebSocket error:", error);
      };

      ws.onclose = (event) => {
        if (wsRef.current !== ws) return;
        console.log("WebSocket closed:", event.code, event.reason);
        wsRef.current = null;
        clearPendingSpeech();

        // D-1: Don't reconnect if cancelled (unmount/hot-reload)
        if (cancelled) return;

        setConnectionStatus("disconnected");

        // Schedule reconnect with exponential backoff
        const delay = getReconnectDelay(reconnectAttemptRef.current);
        console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current + 1})`);

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptRef.current++;
          connect();
        }, delay);
      };
    };

    connect();

    return () => {
      // Cleanup on unmount
      cancelled = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [clearPendingSpeech, clearTerminal, queueSpeech, writeToTerminal, wsUrl]);

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
      terminalRef.current?.focus();
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
      <TauriStatusPanel onStatusChange={handleDesktopStatusChange} />
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
            <div
              ref={terminalContainerRef}
              className="terminal-panel__screen terminal-panel__screen--xterm"
              onClick={() => terminalRef.current?.focus()}
              role="presentation"
            />
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
        <ProfileEditor
          key={profileEditorKey}
          profile={editingProfile === "new" ? null : editingProfile}
          error={profileError}
          isWsOpen={connectionStatus === "connected"}
          onSave={handleSaveProfile}
          onCancel={handleCancelEdit}
        />
      )}
    </div>
  );
}
