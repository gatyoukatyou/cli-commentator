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

export default function App() {
  const [items, setItems] = useState<Array<{ ts: number; text: string }>>([]);
  const [style, setStyle] = useState<Style>("kansai");
  const [source, setSource] = useState<SourceState>({ mode: "auto", detected: null });
  const wsRef = useRef<WebSocket | null>(null);

  const wsUrl = useMemo(() => {
    const port = import.meta.env.VITE_WS_PORT ?? "8787";
    return `ws://localhost:${port}`;
  }, []);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as Msg | LegacyHello;
        const kind = "kind" in msg ? msg.kind : msg.type;
        if (kind === "hello") {
          setStyle(msg.style);
          if ("source" in msg) setSource(msg.source);
        }
        if (kind === "style") setStyle(msg.style);
        if (kind === "source") setSource(msg.source);
        if (kind === "commentary") {
          setItems((prev) => [...prev, { ts: msg.ts, text: msg.text }].slice(-200));
        }
      } catch {}
    };

    return () => ws.close();
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
