import "dotenv/config";
import http from "node:http";
import { WebSocketServer } from "ws";
import * as pty from "node-pty";

import type { Event, SourceMode, SourceState, Style, WsIncoming, WsOutgoing } from "./types.js";
import { redact } from "./redact.js";
import { extractEvents } from "./extract.js";
import { comment } from "./styles/index.js";
import { getAutoDetectedSource, resetAutoDetection } from "./rulesets/index.js";

const PORT = Number(process.env.PORT ?? 8787);

function isStyle(value: unknown): value is Style {
  return value === "standard" || value === "kansai" || value === "zundamon";
}

function normalizeSource(value?: string): SourceMode {
  const source = (value ?? "").trim().toLowerCase();
  if (source === "claude" || source === "codex" || source === "generic") return source;
  return "auto";
}

const sourceMode = normalizeSource(process.env.LOG_SOURCE);
const sourceState: SourceState = {
  mode: sourceMode,
  detected: sourceMode === "auto" ? null : sourceMode
};

if (sourceMode === "auto") {
  resetAutoDetection();
}

// rate limit: max once per 2s (error is always allowed)
let lastEmit = 0;
function shouldEmitNow(): boolean {
  const now = Date.now();
  if (now - lastEmit >= 2000) {
    lastEmit = now;
    return true;
  }
  return false;
}

// --- HTTP + WS ---
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

let currentStyle: Style = "kansai";

function broadcast(msg: WsOutgoing) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

function broadcastSource(nextDetected: SourceState["detected"]) {
  if (sourceState.mode !== "auto") return;
  if (!nextDetected || sourceState.detected === nextDetected) return;
  sourceState.detected = nextDetected;
  broadcast({ kind: "source", source: sourceState });
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ kind: "hello", style: currentStyle, source: sourceState }));

  ws.on("message", (buf) => {
    try {
      const msg = JSON.parse(buf.toString()) as Partial<WsIncoming>;
      if (msg?.kind === "setStyle" && isStyle(msg.style)) {
        currentStyle = msg.style;
        broadcast({ kind: "style", style: currentStyle });
      }
    } catch {}
  });
});

// --- Launch target CLI under PTY ---
const cmd = process.env.TARGET_CMD ?? "bash";
const args = process.env.TARGET_ARGS ? process.env.TARGET_ARGS.split(" ") : [];
const cwd = process.env.TARGET_CWD ?? process.cwd();

const term = pty.spawn(cmd, args, {
  name: "xterm-256color",
  cols: 120,
  rows: 30,
  cwd,
  env: process.env as Record<string, string>
});

// ローカル端末への表示は“生”のまま（実況/UIに出す時だけマスク）
term.onData((data) => process.stdout.write(data));

// 入力をPTYへ（対話CLIを一応動かせる）
if (process.stdin.isTTY) {
  try {
    process.stdin.setRawMode(true);
  } catch {}
  process.stdin.resume();
  process.stdin.on("data", (d) => term.write(d.toString()));
}

broadcast({ kind: "event", ev: { ts: Date.now(), type: "start", summary: "開始", detail: `${cmd} ${args.join(" ")}` } });

term.onData((data) => {
  const clean = redact(data);
  const evs = extractEvents(clean);
  const detected = getAutoDetectedSource();
  if (detected) broadcastSource(detected);

  // raw は “マスク後” を送る（MVP）
  broadcast({ kind: "raw", data: clean });

  for (const ev of evs) {
    broadcast({ kind: "event", ev });
    if (ev.type === "error" || shouldEmitNow()) {
      broadcast({ kind: "commentary", ts: ev.ts, text: comment(ev, currentStyle), ev });
    }
  }
});

term.onExit(({ exitCode }) => {
  const ev: Event = { ts: Date.now(), type: "done", summary: `終了 code=${exitCode}` };
  broadcast({ kind: "event", ev });
  broadcast({ kind: "commentary", ts: ev.ts, text: comment(ev, currentStyle), ev });
});

server.listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`);
});
