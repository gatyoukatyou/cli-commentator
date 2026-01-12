import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

type Style = "standard" | "kansai" | "zundamon";
type DetectedSource = "claude" | "codex" | "generic";
type SourceMode = "auto" | DetectedSource;
type SourceState = { mode: SourceMode; detected: DetectedSource | null };

type Msg =
  | { kind: "hello"; style: Style; source: SourceState }
  | { kind: "style"; style: Style }
  | { kind: "source"; source: SourceState }
  | { kind: "commentary"; ts: number; text: string };

type LegacyHello = { type: "hello"; style: Style };

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

export default function App() {
  const [items, setItems] = useState<Array<{ ts: number; text: string }>>([]);
  const [style, setStyle] = useState<Style>("kansai");
  const [source, setSource] = useState<SourceState>({ mode: "auto", detected: null });
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wsUrl = useMemo(() => {
    const port = import.meta.env.VITE_WS_PORT ?? "8787";
    return `ws://localhost:${port}`;
  }, []);

  useEffect(() => {
    // Exponential backoff: 500ms, 1s, 2s, 4s, 8s, max 10s
    const getReconnectDelay = (attempt: number): number => {
      const baseDelay = 500;
      const maxDelay = 10000;
      return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    };

    const connect = () => {
      // Clear any existing reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      setConnectionStatus(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected");
        setConnectionStatus("connected");
        reconnectAttemptRef.current = 0;
      };

      ws.onmessage = (e) => {
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
        setConnectionStatus("disconnected");
        wsRef.current = null;

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
    wsRef.current?.send(JSON.stringify({ kind: "setStyle", style: s }));
  };

  const sourceLabel =
    source.mode === "auto"
      ? source.detected
        ? `auto → ${source.detected}`
        : "auto (detecting)"
      : source.mode;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}>
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

      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "12px 0" }}>
        <label style={{ fontSize: 14, opacity: 0.8 }}>口調：</label>
        <select value={style} onChange={(e) => sendStyle(e.target.value as Style)}>
          <option value="standard">標準</option>
          <option value="kansai">関西弁</option>
          <option value="zundamon">ずんだもん風（テキスト）</option>
        </select>
        <span style={{ fontSize: 12, opacity: 0.6 }}>（イベント時＋最大2秒に1回）</span>
      </div>

      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
        Ruleset: {sourceLabel}
      </div>

      <div style={{ border: "1px solid #ccc", borderRadius: 8, padding: 12, height: "70vh", overflow: "auto" }}>
        {items.map((it, idx) => (
          <div key={idx} style={{ padding: "6px 0", borderBottom: "1px dashed #ddd" }}>
            <div style={{ fontSize: 12, opacity: 0.6 }}>{new Date(it.ts).toLocaleTimeString()}</div>
            <div style={{ fontSize: 16 }}>{it.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
