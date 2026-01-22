import { useEffect, useMemo, useRef, useState } from "react";
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
import type { Style, SourceState, Profile, ProfileSummary, CreateProfileInput } from "./types";

type Msg =
  | { kind: "hello"; style: Style; source: SourceState }
  | { kind: "style"; style: Style }
  | { kind: "source"; source: SourceState }
  | { kind: "commentary"; ts: number; text: string }
  | { kind: "profiles"; profiles: ProfileSummary[]; activeId: string | null }
  | { kind: "profileSaved"; profile: ProfileSummary; activeId: string | null }
  | { kind: "profileDeleted"; id: string; activeId: string | null }
  | { kind: "profileError"; error: string }
  | { kind: "ptyRestart"; cmd: string; args: string[]; profileId: string | null }
  | { kind: "ptyError"; error: string };

type LegacyHello = { type: "hello"; style: Style };

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

type ServerStatusDetail = {
  desired: "running" | "stopped";
  actual: "alive" | "dead" | "unknown";
  pid: number | null;
  started_at: number | null;
  exit_code: number | null;
  crash_suspected: boolean;
  orphan_suspected: boolean;
  diagnostics: string | null;
  health_ok: boolean;
  last_seen_at: number | null;
  port: number;
};

// Tauri debug panel for Gate B testing
function TauriDebugPanel() {
  const [isTauri, setIsTauri] = useState(false);
  const [status, setStatus] = useState<ServerStatusDetail | null>(null);

  useEffect(() => {
    const tauri = (window as { __TAURI__?: { core?: { invoke: (cmd: string) => Promise<unknown> } } }).__TAURI__;
    if (tauri?.core) {
      setIsTauri(true);
    }
  }, []);

  // Polling (3 second interval)
  useEffect(() => {
    if (!isTauri) return;
    const tauri = (window as { __TAURI__?: { core?: { invoke: (cmd: string) => Promise<unknown> } } }).__TAURI__;

    const poll = async () => {
      try {
        const result = await tauri?.core?.invoke("server_status_detailed");
        setStatus(result as ServerStatusDetail);
      } catch {
        // Ignore polling errors
      }
    };

    poll(); // Initial immediate call
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [isTauri]);

  if (!import.meta.env.DEV || !isTauri) return null;

  const tauri = (window as { __TAURI__?: { core?: { invoke: (cmd: string) => Promise<unknown> } } }).__TAURI__;

  const handleStart = async () => {
    try {
      await tauri?.core?.invoke("start_server");
    } catch {
      // Ignore errors
    }
  };

  const handleStop = async () => {
    try {
      await tauri?.core?.invoke("stop_server");
    } catch {
      // Ignore errors
    }
  };

  return (
    <div style={{
      position: "fixed",
      top: 8,
      right: 8,
      padding: 12,
      backgroundColor: "#1e293b",
      color: "#e2e8f0",
      borderRadius: 8,
      fontSize: 12,
      zIndex: 9999,
      minWidth: 180,
    }}>
      <div style={{ fontWeight: "bold", marginBottom: 8 }}>Tauri Debug</div>

      {status && (
        <div style={{ marginBottom: 8, lineHeight: 1.6 }}>
          <div>Desired: {status.desired}</div>
          <div>Actual: <span style={{
            color: status.actual === "alive" ? "#22c55e" :
                   status.actual === "dead" ? "#ef4444" : "#f59e0b"
          }}>{status.actual}</span></div>
          <div>Health: <span style={{
            color: status.health_ok ? "#22c55e" : "#ef4444"
          }}>{status.health_ok ? "OK" : "NG"}</span></div>
          <div>PID: {status.pid ?? "-"} (port {status.port})</div>
          {status.started_at && (
            <div style={{ fontSize: 10, opacity: 0.7 }}>
              Started: {new Date(status.started_at).toLocaleTimeString()}
            </div>
          )}
          {status.last_seen_at && (
            <div style={{ fontSize: 10, opacity: 0.7 }}>
              Last seen: {new Date(status.last_seen_at).toLocaleTimeString()}
            </div>
          )}
          {status.crash_suspected && (
            <div style={{ color: "#ef4444", marginTop: 4 }}>Crash suspected</div>
          )}
          {status.orphan_suspected && (
            <div style={{ color: "#f59e0b", marginTop: 4 }}>Orphan: port in use</div>
          )}
          {status.actual === "alive" && !status.health_ok && (
            <div style={{ color: "#f59e0b", marginTop: 4 }}>Health check failed</div>
          )}
          {status.diagnostics && (
            <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4 }}>
              [{status.diagnostics}]
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 4 }}>
        <button onClick={handleStart} style={{ padding: "4px 8px" }}>Start</button>
        <button onClick={handleStop} style={{ padding: "4px 8px" }}>Stop</button>
      </div>
    </div>
  );
}

export default function App() {
  const [items, setItems] = useState<Array<{ ts: number; text: string }>>([]);
  const [style, setStyle] = useState<Style>("kansai");
  const [source, setSource] = useState<SourceState>({ mode: "auto", detected: null });
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Profile state
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<Profile | null | "new">(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // TTS state
  const [ttsEnabled, setTtsEnabledState] = useState(() => getTTSEnabled());
  const [ttsSettings, setTtsSettingsState] = useState<TTSSettings>(() => getTTSSettings());
  const [ttsSettingsOpen, setTtsSettingsOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const ttsSupported = isTTSSupported();
  const ttsEnabledRef = useRef(ttsEnabled);
  const ttsSettingsRef = useRef(ttsSettings);

  const wsUrl = useMemo(() => {
    const port = import.meta.env.VITE_WS_PORT ?? "8787";
    return `ws://localhost:${port}`;
  }, []);

  // TTS ref sync (to avoid stale closure in WebSocket handler)
  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
  }, [ttsEnabled]);

  useEffect(() => {
    ttsSettingsRef.current = ttsSettings;
  }, [ttsSettings]);

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
        reconnectAttemptRef.current = 0;
      };

      ws.onmessage = (e) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(e.data) as Msg | LegacyHello;
          const kind = "kind" in msg ? msg.kind : msg.type;
          switch (kind) {
            case "hello":
              if ("style" in msg) setStyle(msg.style);
              if ("source" in msg) setSource(msg.source);
              break;
            case "style":
              if ("style" in msg) setStyle(msg.style);
              break;
            case "source":
              if ("source" in msg) setSource(msg.source);
              break;
            case "commentary":
              if ("ts" in msg && "text" in msg) {
                setItems((prev) => [...prev, { ts: msg.ts, text: msg.text }].slice(-200));
                // TTS: 有効なら読み上げ
                if (ttsEnabledRef.current) {
                  speak(msg.text, ttsSettingsRef.current);
                }
              }
              break;
            case "profiles":
              if ("profiles" in msg) {
                setProfiles(msg.profiles);
                setActiveProfileId(msg.activeId);
              }
              break;
            case "profileSaved":
              if ("profile" in msg) {
                setProfiles((prev) => {
                  const exists = prev.some((p) => p.id === msg.profile.id);
                  if (exists) {
                    return prev.map((p) => (p.id === msg.profile.id ? msg.profile : p));
                  }
                  return [...prev, msg.profile];
                });
                setActiveProfileId(msg.activeId);
                setEditingProfile(null);
                setProfileError(null);
              }
              break;
            case "profileDeleted":
              if ("id" in msg) {
                setProfiles((prev) => prev.filter((p) => p.id !== msg.id));
                setActiveProfileId(msg.activeId);
              }
              break;
            case "profileError":
              if ("error" in msg) {
                setProfileError(msg.error);
              }
              break;
            case "ptyRestart":
              // Clear commentary items when PTY restarts
              setItems([]);
              setProfileError(null);
              break;
            case "ptyError":
              if ("error" in msg) {
                setProfileError(`PTY Error: ${msg.error}`);
              }
              break;
            default:
              break;
          }
        } catch {}
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
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ kind: "setActiveProfile", id }));
    }
  };

  const handleEditProfile = (id: string) => {
    const profile = profiles.find((p) => p.id === id);
    if (profile) {
      // For editing, we need full profile data - for now, create a partial one
      // In a more complete implementation, we'd fetch the full profile
      setEditingProfile({
        id: profile.id,
        name: profile.name,
        cmd: profile.cmd,
        args: [],
        style: "kansai",
        logSource: "auto",
        createdAt: 0,
        updatedAt: 0,
      });
    }
  };

  const handleCreateProfile = () => {
    setEditingProfile("new");
    setProfileError(null);
  };

  const handleDeleteProfile = (id: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ kind: "deleteProfile", id }));
    }
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
    if (wsRef.current?.readyState === WebSocket.OPEN) {
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
    }
  };

  const handleCancelEdit = () => {
    setEditingProfile(null);
    setProfileError(null);
  };

  const sourceLabel =
    source.mode === "auto"
      ? source.detected
        ? `auto → ${source.detected}`
        : "auto (detecting)"
      : source.mode;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}>
      <TauriDebugPanel />
      <h1>CLI 実況（MVP）</h1>

      {/* Connection status indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 12 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor:
              connectionStatus === "connected"
                ? "#22c55e"
                : connectionStatus === "connecting" || connectionStatus === "reconnecting"
                ? "#f59e0b"
                : "#ef4444",
          }}
        />
        <span style={{ opacity: 0.7 }}>
          {connectionStatus === "connected" && "接続中"}
          {connectionStatus === "connecting" && "接続しています..."}
          {connectionStatus === "reconnecting" && "再接続しています..."}
          {connectionStatus === "disconnected" && "切断"}
        </span>
      </div>

      {/* Profile Selector */}
      <div style={{ margin: "12px 0", padding: "12px", backgroundColor: "#f5f5f5", borderRadius: 8 }}>
        <ProfileSelector
          profiles={profiles}
          activeId={activeProfileId}
          disabled={connectionStatus !== "connected"}
          onSelect={handleSelectProfile}
          onEdit={handleEditProfile}
          onCreate={handleCreateProfile}
          onDelete={handleDeleteProfile}
        />
        {profileError && (
          <div style={{ color: "#ef4444", fontSize: 12, marginTop: 8 }}>
            エラー: {profileError}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "12px 0" }}>
        <label style={{ fontSize: 14, opacity: 0.8 }}>口調：</label>
        <select value={style} onChange={(e) => sendStyle(e.target.value as Style)}>
          <option value="standard">標準</option>
          <option value="kansai">関西弁</option>
          <option value="zundamon">ずんだもん風（テキスト）</option>
        </select>
        <span style={{ fontSize: 12, opacity: 0.6 }}>（イベント時＋最大2秒に1回）</span>
      </div>

      {/* TTS Toggle */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "12px 0" }}>
        <label style={{ fontSize: 14, opacity: 0.8, cursor: ttsSupported ? "pointer" : "not-allowed" }}>
          <input
            type="checkbox"
            checked={ttsEnabled}
            onChange={(e) => handleTTSToggle(e.target.checked)}
            disabled={!ttsSupported}
            style={{ marginRight: 8 }}
          />
          読み上げ（TTS）
        </label>
        {ttsSupported && ttsEnabled && (
          <button
            onClick={() => setTtsSettingsOpen((prev) => !prev)}
            style={{
              fontSize: 12,
              padding: "2px 8px",
              cursor: "pointer",
              backgroundColor: ttsSettingsOpen ? "#e5e7eb" : "transparent",
              border: "1px solid #d1d5db",
              borderRadius: 4,
            }}
          >
            {ttsSettingsOpen ? "▼ 設定" : "▶ 設定"}
          </button>
        )}
        {!ttsSupported && (
          <span style={{ fontSize: 12, color: "#ef4444" }}>
            ※ このブラウザはTTS非対応です
          </span>
        )}
      </div>

      {/* TTS Settings Panel */}
      {ttsSupported && ttsEnabled && ttsSettingsOpen && (
        <div
          style={{
            margin: "0 0 12px 0",
            padding: 12,
            backgroundColor: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {/* Voice Select */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
              音声:
            </label>
            {voices.length > 0 ? (
              <select
                value={ttsSettings.voiceURI ?? ""}
                onChange={(e) =>
                  handleTTSSettingsChange({
                    ...ttsSettings,
                    voiceURI: e.target.value || null,
                  })
                }
                style={{ width: "100%", padding: 4 }}
              >
                <option value="">デフォルト</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            ) : voicesLoaded ? (
              <span style={{ color: "#6b7280" }}>音声一覧は取得できません（デフォルト音声のみ）</span>
            ) : (
              <span style={{ color: "#6b7280" }}>音声リストを読み込み中...</span>
            )}
          </div>

          {/* Rate Slider */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
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
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9ca3af" }}>
              <span>遅い (0.5)</span>
              <span>速い (2.0)</span>
            </div>
          </div>

          {/* Pitch Slider */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
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
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9ca3af" }}>
              <span>低い (0.5)</span>
              <span>高い (2.0)</span>
            </div>
          </div>

          {/* Volume Slider */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
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
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9ca3af" }}>
              <span>0%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Test & Reset Buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleTestSpeak}
              style={{
                padding: "6px 12px",
                backgroundColor: "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              テスト読み上げ
            </button>
            <button
              onClick={() => handleTTSSettingsChange(DEFAULT_TTS_SETTINGS)}
              style={{
                padding: "6px 12px",
                backgroundColor: "#6b7280",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              リセット
            </button>
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
        Ruleset: {sourceLabel}
      </div>

      <div style={{ border: "1px solid #ccc", borderRadius: 8, padding: 12, height: "60vh", overflow: "auto" }}>
        {items.map((it, idx) => (
          <div key={idx} style={{ padding: "6px 0", borderBottom: "1px dashed #ddd" }}>
            <div style={{ fontSize: 12, opacity: 0.6 }}>{new Date(it.ts).toLocaleTimeString()}</div>
            <div style={{ fontSize: 16 }}>{it.text}</div>
          </div>
        ))}
      </div>

      {/* Profile Editor Modal */}
      {editingProfile && (
        <ProfileEditor
          profile={editingProfile === "new" ? null : editingProfile}
          onSave={handleSaveProfile}
          onCancel={handleCancelEdit}
        />
      )}
    </div>
  );
}
