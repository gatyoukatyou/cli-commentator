import "dotenv/config";
import http from "node:http";
import { WebSocketServer } from "ws";
import * as pty from "node-pty";

import type { Event, SourceMode, SourceState, Style, WsIncoming, WsOutgoing } from "./types.js";
import { redact } from "./redact.js";
import { extractEvents } from "./extract.js";
import { comment } from "./styles/index.js";
import { getAutoDetectedSource, resetAutoDetection } from "./rulesets/index.js";
import * as profileManager from "./profile/manager.js";
import type { ProfileSummary } from "./profile/types.js";

const PORT = Number(process.env.PORT ?? 8787);
const COMMENT_EXIT_TIMEOUT_MS = parseInt(process.env.COMMENT_EXIT_TIMEOUT_MS ?? "1500", 10);

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

wss.on("connection", async (ws) => {
  // Send initial state including profiles
  const profiles = await profileManager.list();
  const activeId = await profileManager.getActiveId();
  ws.send(JSON.stringify({ kind: "hello", style: currentStyle, source: sourceState }));
  ws.send(JSON.stringify({ kind: "profiles", profiles, activeId }));

  ws.on("message", async (buf) => {
    try {
      const msg = JSON.parse(buf.toString()) as Partial<WsIncoming>;

      switch (msg?.kind) {
        case "setStyle":
          if (isStyle(msg.style)) {
            currentStyle = msg.style;
            broadcast({ kind: "style", style: currentStyle });
          }
          break;

        case "getProfiles": {
          const list = await profileManager.list();
          const active = await profileManager.getActiveId();
          ws.send(JSON.stringify({ kind: "profiles", profiles: list, activeId: active }));
          break;
        }

        case "saveProfile": {
          try {
            const input = msg.profile;
            if (!input) throw new Error("Missing profile data");

            let saved: ProfileSummary;
            if (input.id) {
              // Update existing
              const updated = await profileManager.update(input.id, input);
              saved = { id: updated.id, name: updated.name, cmd: updated.cmd };
            } else {
              // Create new
              const created = await profileManager.create(input);
              saved = { id: created.id, name: created.name, cmd: created.cmd };
            }
            const active = await profileManager.getActiveId();
            broadcast({ kind: "profileSaved", profile: saved, activeId: active });
          } catch (err) {
            ws.send(JSON.stringify({ kind: "profileError", error: String(err) }));
          }
          break;
        }

        case "deleteProfile": {
          try {
            const id = msg.id;
            if (!id) throw new Error("Missing profile id");
            await profileManager.remove(id);
            const active = await profileManager.getActiveId();
            broadcast({ kind: "profileDeleted", id, activeId: active });
          } catch (err) {
            ws.send(JSON.stringify({ kind: "profileError", error: String(err) }));
          }
          break;
        }

        case "setActiveProfile": {
          try {
            const id = msg.id ?? null;
            await profileManager.setActive(id);
            const list = await profileManager.list();
            broadcast({ kind: "profiles", profiles: list, activeId: id });
          } catch (err) {
            ws.send(JSON.stringify({ kind: "profileError", error: String(err) }));
          }
          break;
        }
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
function handleStdinData(d: Buffer) {
  term.write(d.toString());
}

if (process.stdin.isTTY) {
  try {
    process.stdin.setRawMode(true);
  } catch {}
  process.stdin.resume();
  process.stdin.on("data", handleStdinData);
}

broadcast({ kind: "event", ev: { ts: Date.now(), type: "start", summary: "開始", detail: `${cmd} ${args.join(" ")}` } });

term.onData((data) => {
  const clean = redact(data);
  const evs = extractEvents(clean);
  const detected = getAutoDetectedSource();
  if (detected) broadcastSource(detected);

  // raw は "マスク後" を送る（MVP）
  broadcast({ kind: "raw", data: clean });

  for (const ev of evs) {
    broadcast({ kind: "event", ev });
    if (ev.type === "error" || shouldEmitNow()) {
      // comment() is async - fire and forget, errors are handled inside
      void comment(ev, currentStyle)
        .then((text) => {
          broadcast({ kind: "commentary", ts: ev.ts, text, ev });
        })
        .catch(() => {});
    }
  }
});

term.onExit(({ exitCode }) => {
  const ev: Event = { ts: Date.now(), type: "done", summary: `終了 code=${exitCode}` };
  broadcast({ kind: "event", ev });

  // 安全タイマー付き二重化（comment()がsettleしなくてもcleanup確実実行）
  const exitWithCode = exitCode ?? 0;
  let exited = false;
  const safeCleanup = () => {
    if (exited) return;
    exited = true;
    cleanup(exitWithCode);
  };

  // COMMENT_EXIT_TIMEOUT_MS後に強制cleanup（comment()がハングしても確実に終了）
  const hardTimeout = setTimeout(safeCleanup, COMMENT_EXIT_TIMEOUT_MS);

  void comment(ev, currentStyle)
    .then((text) => {
      broadcast({ kind: "commentary", ts: ev.ts, text, ev });
    })
    .catch(() => {})
    .finally(() => {
      clearTimeout(hardTimeout);
      setTimeout(safeCleanup, 100);
    });
});

server.listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`);
});

// --- Cleanup ---
let isCleaningUp = false;

function cleanup(exitCode: number = 0): void {
  if (isCleaningUp) return;
  isCleaningUp = true;
  console.log("\nCleaning up...");

  // 1. stdin: removeListener + pause + raw mode復元
  if (process.stdin.isTTY) {
    process.stdin.removeListener("data", handleStdinData);
    process.stdin.pause();
    try {
      process.stdin.setRawMode(false);
    } catch {}
  }

  // 2. PTY kill
  try {
    term.kill();
  } catch {}

  // 3. WebSocket clients close
  for (const client of wss.clients) {
    try {
      client.close();
    } catch {}
  }

  // 4. WebSocket server close + HTTP server close → 終了
  let closed = 0;

  // D-3: Keep fallback timer reference to clear on normal exit
  const fallbackTimer = setTimeout(() => process.exit(exitCode), 3000);

  const tryExit = () => {
    closed++;
    if (closed >= 2) {
      clearTimeout(fallbackTimer);
      process.exit(exitCode);
    }
  };

  wss.close(() => tryExit());
  server.close(() => tryExit());
}

// --- Signal handlers ---
process.once("SIGINT", () => {
  console.log("\nReceived SIGINT");
  cleanup(0);
});

process.once("SIGTERM", () => {
  console.log("\nReceived SIGTERM");
  cleanup(0);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  cleanup(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  cleanup(1);
});
