import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import type { TerminalPaneHandle, TerminalPaneTheme } from "./components/TerminalPane";
import { AppHeader, type Skin } from "./components/AppHeader";
import { CommentaryPanel } from "./components/CommentaryPanel";
import { Notices } from "./components/Notices";
import { ProfileEditorModal } from "./components/ProfileEditorModal";
import { WorkspaceLeft } from "./components/WorkspaceLeft";
import { useTTS } from "./hooks/useTTS";
import { useCommentatorSocket, type PtyUnavailableNotice } from "./hooks/useCommentatorSocket";
import { useProfileActions } from "./hooks/useProfileActions";
import {
  buildUrgentEventSpeechText,
  createSpokenEventRegistry,
  eventSpeechKey,
  toAttentionNotice,
  type AttentionNotice,
} from "./lib/event-notify";
import type { CommentaryItem } from "./lib/log-filter";
import {
  buildLaunchDraft,
  buildLaunchSessionInput,
  type LaunchDraft,
  type LaunchPresetId,
} from "./lib/session-launcher";
import { copyWithFallback, getTauriCore, type ServerStatusDetail } from "./lib/tauri";
import { normalizeSuggestion } from "./lib/text";
import type {
  CommentaryDisplayMode,
  Event,
  Style,
  SourceState,
  Profile,
  ProfileSummary,
} from "./types";

const TauriStatusPanel = lazy(() => import("./components/TauriStatusPanel"));

const TERMINAL_OUTPUT_MAX_CHARS = 24000;

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

export default function App() {
  const isTauriRuntime = Boolean(getTauriCore());
  const [items, setItems] = useState<CommentaryItem[]>([]);
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
  const terminalPaneRef = useRef<TerminalPaneHandle | null>(null);

  // Profile state
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<Profile | null | "new" | "loading">(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const profilesRef = useRef<ProfileSummary[]>([]);

  // 要対応状態（urgentイベントの最新1件を表示）
  const [attention, setAttention] = useState<AttentionNotice | null>(null);
  // 即時イベントで読み上げ済みのキー（後続commentaryの二重読み上げ防止）
  const spokenEventsRef = useRef(createSpokenEventRegistry());

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
    speakUrgentNow,
    handleTTSToggle,
    handleTTSSettingsChange,
    handleTTSPresetChange,
    handleTestSpeak,
  } = useTTS({ commentaryDisplayMode });

  // ルールベースの即時イベント: urgentは要対応表示＋定型文の割り込み読み上げ
  const handleServerEvent = useCallback(
    (ev: Event) => {
      if ((ev.priority ?? "progress") !== "urgent") return;
      setAttention(toAttentionNotice(ev));
      if (speakUrgentNow(buildUrgentEventSpeechText(ev))) {
        // 読み上げ済みを記録し、同一イベントのcommentary読み上げをスキップする
        spokenEventsRef.current.add(eventSpeechKey(ev.ts, ev.type));
      }
    },
    [speakUrgentNow]
  );

  const clearAttention = useCallback(() => {
    setAttention(null);
  }, []);

  // 即時イベントで読み上げ済みのcommentaryはTTSしない（表示はする）
  const queueSpeechDeduped = useCallback(
    (item: CommentaryItem) => {
      if (spokenEventsRef.current.has(eventSpeechKey(item.ts, item.eventType))) return;
      queueSpeech(item);
    },
    [queueSpeech]
  );

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
    queueSpeech: queueSpeechDeduped,
    clearPendingSpeech,
    stopAndClearSpeech,
    onServerEvent: handleServerEvent,
    clearAttention,
  });
  const {
    handleSelectProfile,
    handleEditProfile,
    handleCreateProfile,
    handleDeleteProfile,
    handleSaveProfile,
    handleCancelEdit,
  } = useProfileActions({
    wsRef,
    pendingEditIdRef,
    setEditingProfile,
    setProfileError,
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
      <Notices
        attention={attention}
        onDismissAttention={clearAttention}
        ptyUnavailable={ptyUnavailable}
        profileError={profileError}
        ptyError={ptyError}
        copyState={copyState}
        onCopySuggestion={handleCopySuggestion}
      />
      <AppHeader skin={skin} connectionStatus={connectionStatus} onSkinChange={setSkin} />
      <div className="workspace-layout">
        <WorkspaceLeft
          launchDraft={launchDraft}
          setLaunchDraft={setLaunchDraft}
          style={style}
          connected={connectionStatus === "connected"}
          onSelectPreset={handleSelectLaunchPreset}
          onLaunch={handleLaunchSession}
          terminalPaneRef={terminalPaneRef}
          terminalTheme={terminalTheme}
          currentSessionLabel={currentSessionLabel}
          pendingTerminalOutput={pendingTerminalOutput}
          onTerminalData={sendTerminalInput}
          onPendingOutputFlushed={handlePendingTerminalOutputFlushed}
          onClearTerminal={clearTerminal}
          profiles={profiles}
          activeProfileId={activeProfileId}
          onSelectProfile={handleSelectProfile}
          onEditProfile={handleEditProfile}
          onCreateProfile={handleCreateProfile}
          onDeleteProfile={handleDeleteProfile}
        />
        <CommentaryPanel
          source={source}
          style={style}
          displayMode={commentaryDisplayMode}
          items={items}
          ttsSupported={ttsSupported}
          ttsEnabled={ttsEnabled}
          ttsSettingsOpen={ttsSettingsOpen}
          setTtsSettingsOpen={setTtsSettingsOpen}
          ttsSettings={ttsSettings}
          voices={voices}
          voicesLoaded={voicesLoaded}
          onStyleChange={sendStyle}
          onDisplayModeChange={setCommentaryDisplayMode}
          onTTSToggle={handleTTSToggle}
          onTTSPresetChange={handleTTSPresetChange}
          onTTSSettingsChange={handleTTSSettingsChange}
          onTestSpeak={handleTestSpeak}
        />
      </div>

      <ProfileEditorModal
        editingProfile={editingProfile}
        error={profileError}
        connected={connectionStatus === "connected"}
        onSave={handleSaveProfile}
        onCancel={handleCancelEdit}
      />
    </div>
  );
}
