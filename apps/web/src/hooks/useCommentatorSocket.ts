import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { TerminalPaneHandle } from "../components/TerminalPane";
import { getCommentaryTextParts } from "../lib/glossary-note";
import { isEventType, type CommentaryItem } from "../lib/log-filter";
import { normalizeSuggestion } from "../lib/text";
import type {
  Profile,
  ProfileSummary,
  PtyUnavailablePayload,
  ServerToClientMessage,
  SourceState,
  Style,
} from "../types";

type LegacyHello = { type: "hello"; style: Style };
type PayloadMessage = { type?: string; payload?: PtyUnavailablePayload | Record<string, unknown> };
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
              terminalPaneRef.current?.resetInputGate();
              stopAndClearSpeech();
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
  }, [
    clearPendingSpeech,
    clearTerminal,
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
