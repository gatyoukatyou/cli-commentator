import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
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
  DEFAULT_TTS_SETTINGS,
  type TTSSettings,
} from "./lib/tts";
import { getDesktopFailureGuidance, type DesktopServerState } from "./lib/recovery";
import {
  EVENT_TYPE_LABELS,
  EVENT_TYPE_OPTIONS,
  filterCommentaryItems,
  isEventType,
  type CommentaryItem,
  type LogEventTypeFilter,
} from "./lib/log-filter";
import type {
  Style,
  SourceState,
  Profile,
  ProfileSummary,
  CreateProfileInput,
  ServerToClientMessage,
  PtyUnavailablePayload,
} from "./types";

export type Skin = "standard" | "brutalism" | "paper";

type LegacyHello = { type: "hello"; style: Style };
type PayloadMessage = { type?: string; payload?: PtyUnavailablePayload | Record<string, unknown> };

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

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

const normalizeSuggestion = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
        <>
          <div className="debug-panel__meta">想定原因: {failureGuidance.category}</div>
          <ul className="debug-panel__recovery">
            {failureGuidance.hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </>
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
  const [tauriServerPort, setTauriServerPort] = useState<number | null>(null);
  const [skin, setSkin] = useState<Skin>(() => {
    const saved = localStorage.getItem("cli-commentator-skin");
    return (saved as Skin) || "standard";
  });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEditIdRef = useRef<string | null>(null);

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

  // Apply skin to document
  useEffect(() => {
    document.documentElement.setAttribute("data-skin", skin);
    localStorage.setItem("cli-commentator-skin", skin);
  }, [skin]);

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

  // TTS cleanup on unmount (prevent orphan speech on reload/navigation)
  useEffect(() => () => stopSpeech(), []);

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
      stopSpeech();
      setTtsSettingsOpen(false);
    }
  };

  const handleTTSSettingsChange = (newSettings: TTSSettings) => {
    setTtsSettingsState(newSettings);
    setTTSSettings(newSettings);
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
        if (cancelled) return;
        console.log("WebSocket connected");
        setConnectionStatus("connected");
        setProfileError(null); // Clear WS offline error on reconnect
        reconnectAttemptRef.current = 0;
      };

      ws.onmessage = (e) => {
        if (cancelled) return;
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
            case "commentary":
              if (typeof data.ts === "number" && typeof data.text === "string") {
                const ev = isRecord(data.ev) ? data.ev : null;
                const eventTypeCandidate = ev?.type;
                const eventType = isEventType(eventTypeCandidate) ? eventTypeCandidate : "stdout";
                const summary = typeof ev?.summary === "string" ? ev.summary : undefined;
                const detail = typeof ev?.detail === "string" ? ev.detail : undefined;
                setItems((prev) =>
                  [...prev, { ts: data.ts as number, text: data.text as string, eventType, summary, detail }].slice(-200)
                );
                // TTS: 有効なら読み上げ
                if (ttsEnabledRef.current) {
                  speak(data.text as string, ttsSettingsRef.current);
                }
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
              setProfileError(null);
              setPtyError(null);
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
        console.error("WebSocket error:", error);
      };

      ws.onclose = (event) => {
        console.log("WebSocket closed:", event.code, event.reason);
        wsRef.current = null;

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
  }, [wsUrl]);

  const sendStyle = (s: Style) => {
    setStyle(s);
    // D-2: Only send when connection is open
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ kind: "setStyle", style: s }));
    }
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
    llmProvider: string;
  }) => {
    setProfileError(null);
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setProfileError("サーバーに接続されていません。再接続を待ってください。");
      return;
    }
    const profile: CreateProfileInput & { id?: string } = {
      id: input.id,
      name: input.name,
      cmd: input.cmd,
      args: input.args.split(" ").filter(Boolean),
      cwd: input.cwd || undefined,
      style: input.style,
      logSource: input.logSource,
      llmProvider: input.llmProvider as CreateProfileInput["llmProvider"],
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
  const filteredItems = useMemo(
    () => filterCommentaryItems(items, { query: logQuery, eventType: logEventType }),
    [items, logEventType, logQuery]
  );

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
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "var(--space-4)" }}>
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
          <option value="brutalism">Brutalism</option>
          <option value="paper">Paper</option>
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

      {/* Profile Selector */}
      <div className="panel" style={{ margin: "var(--space-3) 0" }}>
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

      <div className="control-row">
        <label className="control-row__label">口調：</label>
        <select value={style} onChange={(e) => sendStyle(e.target.value as Style)}>
          <option value="standard">標準</option>
          <option value="kansai">関西弁</option>
          <option value="zundamon">ずんだもん風（テキスト）</option>
        </select>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--color-fg-tertiary)" }}>（イベント時＋最大2秒に1回）</span>
      </div>

      {/* TTS Toggle */}
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

      {/* TTS Settings Panel */}
      {ttsSupported && ttsEnabled && ttsSettingsOpen && (
        <div className="tts-settings">
          {/* Voice Select */}
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

          {/* Rate Slider */}
          <div className="tts-settings__field">
            <label className="tts-settings__label">
              速度: {ttsSettings.rate.toFixed(1)}
            </label>
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

          {/* Pitch Slider */}
          <div className="tts-settings__field">
            <label className="tts-settings__label">
              音程: {ttsSettings.pitch.toFixed(1)}
            </label>
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

          {/* Volume Slider */}
          <div className="tts-settings__field">
            <label className="tts-settings__label">
              音量: {Math.round(ttsSettings.volume * 100)}%
            </label>
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

          {/* Test & Reset Buttons */}
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

      <div style={{ fontSize: "var(--text-sm)", color: "var(--color-fg-secondary)", marginBottom: "var(--space-2)" }}>
        Ruleset: {sourceLabel}
      </div>

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
        </div>
      </div>

      <div className="log-container">
        {filteredItems.length === 0 ? (
          <div className="log-empty">条件に一致するログはありません。</div>
        ) : (
          filteredItems.map((it, idx) => (
            <div key={`${it.ts}-${idx}-${it.eventType}`} className="log-item">
              <div className="log-item__header">
                <div className="log-item__time">{new Date(it.ts).toLocaleTimeString()}</div>
                <div className="log-item__type">{EVENT_TYPE_LABELS[it.eventType]}</div>
              </div>
              <div className="log-item__text">{it.text}</div>
            </div>
          ))
        )}
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
