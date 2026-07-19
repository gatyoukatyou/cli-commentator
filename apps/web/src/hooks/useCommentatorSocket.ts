import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { TerminalPaneHandle } from "../components/TerminalPane";
import { getCommentaryTextParts } from "../lib/glossary-note";
import type { CommentaryItem } from "../lib/log-filter";
import { normalizeSuggestion } from "../lib/text";
import { parseServerMessage } from "@cli-commentator/shared";
import type {
  Event,
  Profile,
  ProfileSummary,
  SourceState,
  Style,
} from "../types";

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting";
type EditingProfile = Profile | null | "new" | "loading";
type CopyState = "idle" | "copied" | "failed";

export type PtyUnavailableNotice = {
  error?: string;
  suggestion?: string;
  receivedAt: number;
};

type UseCommentatorSocketOptions = {
  wsUrl: string;
  pendingEditIdRef: MutableRefObject<string | null>;
  profilesRef: MutableRefObject<ProfileSummary[]>;
  terminalPaneRef: RefObject<TerminalPaneHandle | null>;
  setItems: Dispatch<SetStateAction<CommentaryItem[]>>;
  setStyle: Dispatch<SetStateAction<Style>>;
  setSource: Dispatch<SetStateAction<SourceState>>;
  setProfiles: Dispatch<SetStateAction<ProfileSummary[]>>;
  setActiveProfileId: Dispatch<SetStateAction<string | null>>;
  setEditingProfile: Dispatch<SetStateAction<EditingProfile>>;
  setProfileError: Dispatch<SetStateAction<string | null>>;
  setPtyError: Dispatch<SetStateAction<string | null>>;
  setPtyUnavailable: Dispatch<SetStateAction<PtyUnavailableNotice | null>>;
  setCopyState: Dispatch<SetStateAction<CopyState>>;
  setCurrentSessionLabel: Dispatch<SetStateAction<string>>;
  writeToTerminal: (data: string) => void;
  clearTerminal: () => void;
  queueSpeech: (item: CommentaryItem) => void;
  clearPendingSpeech: () => void;
  stopAndClearSpeech: () => void;
  onServerEvent: (ev: Event) => void;
  clearAttention: () => void;
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

export function useCommentatorSocket({
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
  onServerEvent,
  clearAttention,
}: UseCommentatorSocketOptions) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          const message = parseServerMessage(JSON.parse(e.data));
          if (!message) return;

          switch (message.kind) {
            case "hello":
              setStyle(message.style);
              setSource(message.source);
              break;
            case "style":
              setStyle(message.style);
              break;
            case "source":
              setSource(message.source);
              break;
            case "raw":
              writeToTerminal(message.data);
              break;
            case "commentary": {
              const parts = getCommentaryTextParts({
                narration: message.narration,
                explanation: message.explanation,
                glossaryNotes: message.glossaryNotes,
              });
              if (!parts.narrationText && !parts.explanationText && parts.glossaryNotes.length === 0) {
                break;
              }
              const nextItem: CommentaryItem = {
                ts: message.ts,
                narration: parts.narrationText ?? undefined,
                explanation: parts.explanationText ?? undefined,
                glossaryNotes: parts.glossaryNotes,
                eventType: message.ev.type,
                priority: message.ev.priority ?? "progress",
                summary: message.ev.summary,
                detail: message.ev.detail,
                speech: message.speech,
              };
              setItems((prev) => [...prev, nextItem].slice(-200));
              queueSpeech(nextItem);
              break;
            }
            case "profiles":
              setProfiles(message.profiles);
              setActiveProfileId(message.activeId);
              break;
            case "profileSaved": {
              const profile = message.profile;
              setProfiles((prev) => {
                const exists = prev.some((entry) => entry.id === profile.id);
                if (exists) {
                  return prev.map((entry) => (entry.id === profile.id ? profile : entry));
                }
                return [...prev, profile];
              });
              setActiveProfileId(message.activeId);
              setEditingProfile(null);
              setProfileError(null);
              break;
            }
            case "profileDeleted":
              setProfiles((prev) => prev.filter((profile) => profile.id !== message.id));
              setActiveProfileId(message.activeId);
              break;
            case "profileDetail":
              if (pendingEditIdRef.current === message.profile.id) {
                setEditingProfile(message.profile);
                pendingEditIdRef.current = null;
              }
              break;
            case "profileError": {
              setProfileError(message.error);
              const pendingId = pendingEditIdRef.current;
              if (pendingId) {
                pendingEditIdRef.current = null;
                const summary = profilesRef.current.find((profile) => profile.id === pendingId);
                setEditingProfile(summary ? stubProfileFromSummary(summary) : null);
              }
              break;
            }
            case "ptyRestart":
              setItems([]);
              clearTerminal();
              terminalPaneRef.current?.resetInputGate();
              stopAndClearSpeech();
              clearAttention();
              setProfileError(null);
              setPtyError(null);
              setCurrentSessionLabel([message.cmd, ...message.args].filter(Boolean).join(" ") || "session");
              break;
            case "ptyError":
              setPtyError(message.error);
              break;
            case "ptyUnavailable":
              setCopyState("idle");
              setPtyUnavailable({
                error: normalizeSuggestion(message.error),
                suggestion: normalizeSuggestion(message.suggestion),
                receivedAt: Date.now(),
              });
              break;
            case "event":
              // ルールベースの即時イベント。urgentの要対応表示・定型TTSに使う
              onServerEvent(message.ev);
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
  }, [
    clearAttention,
    clearPendingSpeech,
    clearTerminal,
    onServerEvent,
    pendingEditIdRef,
    profilesRef,
    queueSpeech,
    setActiveProfileId,
    setCopyState,
    setCurrentSessionLabel,
    setEditingProfile,
    setItems,
    setProfileError,
    setProfiles,
    setPtyError,
    setPtyUnavailable,
    setSource,
    setStyle,
    stopAndClearSpeech,
    terminalPaneRef,
    writeToTerminal,
    wsUrl,
  ]);

  return { wsRef, connectionStatus };
}
