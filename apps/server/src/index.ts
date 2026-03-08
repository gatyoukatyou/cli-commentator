import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import { WebSocketServer } from "ws";

import type { Event, InputMode, SourceMode, SourceState, Style, WsIncoming, WsOutgoing } from "./types.js";
import { redact } from "./redact.js";
import { extractEvents } from "./extract.js";
import { comment } from "./styles/index.js";
import { getAutoDetectedSource, resetAutoDetection } from "./rulesets/index.js";
import * as profileManager from "./profile/manager.js";
import {
  createPTYManager,
  configFromProfile,
  configFromEnv,
  getNodePtyError,
  classifyPtyFailure,
  buildPtyStartupFailureLog,
  formatPtyStartupFailureLog,
  createPtyUnavailableMessage,
  type PTYConfig,
  type PtyFailure,
  type FileFallbackResult,
} from "./pty/index.js";
import { createFileTail, resolveFileFallback, type FileTail } from "./input/index.js";
import {
  buildServerStateEvent,
  formatServerStateEvent,
  type ServerRuntimeState,
} from "./runtime/state-event.js";

const PORT = Number(process.env.CLI_COMMENTATOR_PORT ?? process.env.PORT ?? 8787);
const COMMENT_EXIT_TIMEOUT_MS = parseInt(process.env.COMMENT_EXIT_TIMEOUT_MS ?? "1500", 10);

const INPUT_MODE_RAW = process.env.INPUT_MODE; // For debugging

function parseInputMode(value?: string): InputMode {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "" || normalized === "pty") return "pty";
  if (normalized === "file") return "file";
  // Unknown value: warn and fallback to pty
  console.warn(`[WARN] Unknown INPUT_MODE="${value}", falling back to "pty". Valid values: pty, file`);
  return "pty";
}

const INPUT_MODE: InputMode = parseInputMode(INPUT_MODE_RAW);
const INPUT_FILE = process.env.INPUT_FILE ?? "";
let runtimeInputMode: InputMode = INPUT_MODE;

function isStyle(value: unknown): value is Style {
  return value === "standard" || value === "kansai" || value === "zundamon";
}

function normalizeSource(value?: string): SourceMode {
  const source = (value ?? "").trim().toLowerCase();
  if (source === "claude" || source === "codex" || source === "generic") return source;
  return "auto";
}

// --- Mutable state ---
let currentStyle: Style = "kansai";
let currentSourceMode: SourceMode = normalizeSource(process.env.LOG_SOURCE);
let sourceState: SourceState = {
  mode: currentSourceMode,
  detected: currentSourceMode === "auto" ? null : currentSourceMode,
};

// PTY restart serialization state
let restartInFlight = false;
let queuedProfileId: string | null | undefined = undefined; // undefined means no queue
let currentlyRunningProfileId: string | null = null; // Track which profile the PTY is running with
let lifecycleState: ServerRuntimeState = "booting";

// PTY availability state (for graceful degradation when node-pty build fails)
let ptyAvailable = true;
let ptyInitError: string | null = null;

function markPtyUnavailable(error: string): void {
  ptyAvailable = false;
  ptyInitError = error;
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
  // /healthz is the primary health check endpoint (Kubernetes convention)
  // /health is kept for backwards compatibility
  if (req.url === "/healthz" || req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

// --- PTY Manager ---
const ptyManager = createPTYManager();

// --- File Tail (for file input mode) ---
let fileTail: FileTail | null = null;
let ignoredFileTailExit: FileTail | null = null;
let stdinPassthroughEnabled = false;
let isCleaningUp = false;
const NO_FILE_FALLBACK: FileFallbackResult = {
  attempted: false,
  activated: false,
  reason: "not_attempted",
};

function transitionServerState(
  trigger: string,
  next: ServerRuntimeState,
  options?: {
    detail?: string;
    level?: "log" | "warn" | "error";
    inputMode?: InputMode;
    profileId?: string | null;
  }
): void {
  if (lifecycleState === next) return;
  const event = buildServerStateEvent({
    trigger,
    from: lifecycleState,
    to: next,
    inputMode: options?.inputMode ?? runtimeInputMode,
    profileId: options?.profileId ?? currentlyRunningProfileId,
    detail: options?.detail,
  });
  lifecycleState = next;
  const line = formatServerStateEvent(event);
  const level = options?.level ?? "log";
  if (level === "warn") {
    console.warn(line);
    return;
  }
  if (level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
}

function logPtyStartupFailure(context: "startup" | "restart", failure: PtyFailure, fallback: FileFallbackResult): void {
  const payload = buildPtyStartupFailureLog({
    context,
    failure,
    inputMode: runtimeInputMode,
    fallback,
  });
  const line = formatPtyStartupFailureLog(payload);
  if (failure.kind === "ptyUnavailable") {
    console.warn(line);
    return;
  }
  console.error(line);
}

/**
 * Process incoming data from any input source (PTY or FileTail).
 * This is the common data processing pipeline.
 */
function processInputData(data: string, writeToStdout: boolean = true): void {
  // Write raw data to local terminal (only for PTY mode or when requested)
  if (writeToStdout) {
    process.stdout.write(data);
  }

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
}

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

/**
 * Setup PTY with event handlers
 */
function setupPTY(config: PTYConfig, profileId: string | null): void {
  const term = ptyManager.spawn(config);
  transitionServerState("setup_pty_success", "pty_running", {
    inputMode: "pty",
    profileId,
    detail: `${config.cmd} ${config.args.join(" ")}`.trim(),
  });

  // Reset auto-detection when spawning new PTY
  if (sourceState.mode === "auto") {
    resetAutoDetection();
    sourceState.detected = null;
  }

  // Process and broadcast data using common pipeline
  term.onData((data) => {
    if (ptyManager.current !== term) return;
    processInputData(data, true);
  });

  // Handle PTY exit - only trigger cleanup for final exit, not for profile switch
  term.onExit(({ exitCode }) => {
    if (ptyManager.current !== term) {
      return;
    }
    // If we're restarting, don't broadcast done or trigger cleanup
    if (restartInFlight || queuedProfileId !== undefined) {
      return;
    }

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

  // Broadcast start event (ptyRestart is sent separately in restartPTY for correct ordering)
  const startEvent: Event = {
    ts: Date.now(),
    type: "start",
    summary: "開始",
    detail: `${config.cmd} ${config.args.join(" ")}`,
  };
  broadcast({ kind: "event", ev: startEvent });

  // Send commentary for start event
  void comment(startEvent, currentStyle)
    .then((text) => {
      broadcast({ kind: "commentary", ts: Date.now(), text, ev: startEvent });
    })
    .catch((err) => {
      // Fallback: show basic start message if LLM fails
      broadcast({
        kind: "commentary",
        ts: Date.now(),
        text: `開始: ${startEvent.detail}`,
        ev: startEvent,
      });
      console.error("start commentary failed:", err);
    });
}

/**
 * Restart PTY with new profile settings
 * Serialized to prevent race conditions from rapid profile switches
 */
async function restartPTY(profileId: string | null, force = false): Promise<void> {
  // If a restart is already in progress, queue this request (only keep the latest)
  if (restartInFlight) {
    queuedProfileId = profileId;
    return;
  }

  // Check if we're already running this profile (skip unnecessary restart)
  if (!force && profileId === currentlyRunningProfileId && (ptyManager.current !== null || fileTail !== null)) {
    // Already running this profile - no restart needed
    return;
  }

  restartInFlight = true;
  transitionServerState("restart_begin", "restarting", { profileId });
  let nextInputMode: InputMode = INPUT_MODE;

  try {
    let config: PTYConfig | null = null;
    let filePath: string | null = null;
    let newStyle = currentStyle;
    let newSourceMode = currentSourceMode;

    if (profileId) {
      const profile = await profileManager.get(profileId);
      if (!profile) {
        broadcast({ kind: "ptyError", error: `Profile not found: ${profileId}` });
        return;
      }
      nextInputMode = profile.inputMode ?? "pty";
      newStyle = profile.style;
      newSourceMode = profile.logSource;
      if (nextInputMode === "file") {
        filePath = (profile.inputFile ?? "").trim();
        if (!filePath) {
          throw new Error("inputFile is required when inputMode=file");
        }
      } else {
        config = configFromProfile(profile);
      }
    } else {
      // No profile - use environment variables
      nextInputMode = INPUT_MODE;
      newStyle = (process.env.STYLE as Style) ?? "kansai";
      newSourceMode = normalizeSource(process.env.LOG_SOURCE);
      if (nextInputMode === "file") {
        filePath = INPUT_FILE.trim();
        if (!filePath) {
          throw new Error("INPUT_FILE is required when INPUT_MODE=file");
        }
      } else {
        config = configFromEnv();
      }
    }

    // Kill existing PTY / file tail fallback
    ptyManager.kill();
    stopFileTail(true);
    disableStdinPassthrough();

    // Update current state
    currentStyle = newStyle;
    currentSourceMode = newSourceMode;
    sourceState = {
      mode: newSourceMode,
      detected: newSourceMode === "auto" ? null : newSourceMode,
    };

    // Broadcast in correct order: ptyRestart -> style -> source -> (then event:start from setupPTY)
    broadcast({
      kind: "ptyRestart",
      cmd: nextInputMode === "file" ? "file" : config?.cmd ?? "file",
      args: nextInputMode === "file" ? [filePath ?? ""] : config?.args ?? [],
      profileId,
    });
    broadcast({ kind: "style", style: currentStyle });
    broadcast({ kind: "source", source: sourceState });

    if (nextInputMode === "file") {
      runtimeInputMode = "file";
      setupFileTail(filePath ?? "", { fatal: false });
    } else {
      runtimeInputMode = "pty";
      setupPTY(config as PTYConfig, profileId);
      enableStdinPassthrough();
    }

    // Update tracking
    currentlyRunningProfileId = profileId;
  } catch (err) {
    if (nextInputMode === "file") {
      const message = err instanceof Error ? err.message : String(err);
      transitionServerState("restart_failed", "failed", {
        level: "error",
        inputMode: "file",
        detail: message,
        profileId,
      });
      broadcast({ kind: "ptyError", error: message });
      console.error("Failed to restart file monitoring:", err);
      return;
    }

    const failure = classifyPtyFailure(err, getNodePtyError());
    if (failure.kind === "ptyUnavailable") {
      markPtyUnavailable(failure.error);
      broadcast(createPtyUnavailableMessage(failure.error));
      const fallback = tryStartFileFallback("restart");
      logPtyStartupFailure("restart", failure, fallback);
      if (!fallback.activated) {
        transitionServerState("restart_failed", "failed", {
          level: "warn",
          detail: `kind=${failure.kind}; fallback_reason=${fallback.reason}; error=${failure.error}`,
          profileId,
        });
      } else {
        transitionServerState("restart_fallback_file", "file_running", {
          level: "warn",
          inputMode: "file",
          detail: `fallback_reason=${fallback.reason}`,
          profileId,
        });
      }
      if (fallback.activated) {
        console.warn(`[INFO] Switched to file monitoring fallback (${INPUT_FILE}) after PTY restart failure.`);
      }
      console.error("[WARN] PTY restart failed because node-pty is unavailable:", failure.error);
      return;
    }

    logPtyStartupFailure("restart", failure, NO_FILE_FALLBACK);
    transitionServerState("restart_failed", "failed", {
      level: "error",
      detail: `kind=${failure.kind}; error=${failure.error}`,
      profileId,
    });
    broadcast({ kind: "ptyError", error: failure.error });
    console.error("Failed to restart PTY:", err);
  } finally {
    restartInFlight = false;

    // Process queued restart if any
    if (queuedProfileId !== undefined) {
      const nextProfileId = queuedProfileId;
      queuedProfileId = undefined;
      // Use setImmediate to avoid stack overflow on rapid calls
      setImmediate(() => {
        void restartPTY(nextProfileId);
      });
    }
  }
}

// --- WebSocket connection handler ---
// Helper to send a message to a single client
function sendTo(client: typeof wss.clients extends Set<infer T> ? T : never, msg: WsOutgoing) {
  if (client.readyState === 1) {
    client.send(JSON.stringify(msg));
  }
}

wss.on("connection", async (ws) => {
  // Send initial state including profiles
  const profiles = await profileManager.list();
  const activeId = await profileManager.getActiveId();
  ws.send(JSON.stringify({ kind: "hello", style: currentStyle, source: sourceState }));
  ws.send(JSON.stringify({ kind: "profiles", profiles, activeId }));

  // Notify client if PTY is unavailable (e.g., node-pty build failed)
  if (!ptyAvailable && ptyInitError) {
    sendTo(ws, createPtyUnavailableMessage(ptyInitError));
  }

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

        case "getProfile": {
          try {
            const id = msg.id;
            if (!id) throw new Error("Missing profile id");
            const profile = await profileManager.get(id);
            if (!profile) {
              ws.send(JSON.stringify({ kind: "profileError", error: `Profile not found: ${id}` }));
            } else {
              ws.send(JSON.stringify({ kind: "profileDetail", profile }));
            }
          } catch (err) {
            ws.send(JSON.stringify({ kind: "profileError", error: String(err) }));
          }
          break;
        }

        case "saveProfile": {
          try {
            const input = msg.profile;
            if (!input) throw new Error("Missing profile data");

            let savedId: string;
            if (input.id) {
              // Update existing
              const updated = await profileManager.update(input.id, input);
              savedId = updated.id;
            } else {
              // Create new
              const created = await profileManager.create(input);
              savedId = created.id;
            }
            const summaries = await profileManager.list();
            const saved = summaries.find((profile) => profile.id === savedId);
            if (!saved) {
              throw new Error(`Saved profile not found: ${savedId}`);
            }
            const active = await profileManager.getActiveId();
            broadcast({ kind: "profileSaved", profile: saved, activeId: active });
            if (active === savedId) {
              await restartPTY(active, true);
            }
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
            // Restart PTY with new profile settings
            await restartPTY(id);
          } catch (err) {
            ws.send(JSON.stringify({ kind: "profileError", error: String(err) }));
          }
          break;
        }
      }
    } catch {}
  });
});

// --- File Tail Setup ---
/**
 * Setup file tail input source for external log monitoring.
 * @see Issue #40
 */
function setupFileTail(filePath: string, options?: { fatal?: boolean }): void {
  const fatal = options?.fatal ?? true;
  if (!filePath) {
    transitionServerState("file_tail_setup_failed", "failed", {
      level: "error",
      inputMode: "file",
      detail: "INPUT_FILE is required",
    });
    console.error("INPUT_FILE is required when INPUT_MODE=file");
    if (fatal) {
      process.exit(1);
    }
    throw new Error("INPUT_FILE is required when INPUT_MODE=file");
  }

  console.log(`Starting file tail mode: ${filePath}`);

  // Reset auto-detection
  if (sourceState.mode === "auto") {
    resetAutoDetection();
    sourceState.detected = null;
  }

  const tail = createFileTail({
    filePath,
    tailLines: 10,
    encoding: "utf-8",
  });
  fileTail = tail;

  // Process data through common pipeline (no stdout echo for file mode)
  tail.on("data", (data) => processInputData(data, false));

  // Handle errors
  tail.on("error", (err) => {
    console.error("File tail error:", err.message);
    const ev: Event = { ts: Date.now(), type: "error", summary: "ファイル監視エラー", detail: err.message };
    broadcast({ kind: "event", ev });
  });

  // Handle exit
  tail.on("exit", (code) => {
    if (fileTail === tail) {
      fileTail = null;
    }
    const ignoredExit = ignoredFileTailExit === tail || isCleaningUp;
    if (ignoredFileTailExit === tail) {
      ignoredFileTailExit = null;
    }
    if (ignoredExit) {
      return;
    }

    console.log(`File tail exited with code: ${code}`);
    const ev: Event = { ts: Date.now(), type: "done", summary: `ファイル監視終了 code=${code}` };
    broadcast({ kind: "event", ev });

    void comment(ev, currentStyle)
      .then((text) => {
        broadcast({ kind: "commentary", ts: ev.ts, text, ev });
      })
      .catch(() => {})
      .finally(() => {
        cleanup(code ?? 0);
      });
  });

  // Start tailing
  try {
    tail.start();
    transitionServerState("file_tail_started", "file_running", {
      inputMode: "file",
      detail: filePath,
    });

    // Broadcast start event
    const startEvent: Event = {
      ts: Date.now(),
      type: "start",
      summary: "ファイル監視開始",
      detail: `tail -f ${filePath}`,
    };
    broadcast({ kind: "event", ev: startEvent });

    void comment(startEvent, currentStyle)
      .then((text) => {
        broadcast({ kind: "commentary", ts: Date.now(), text, ev: startEvent });
      })
      .catch((err) => {
        broadcast({
          kind: "commentary",
          ts: Date.now(),
          text: `ファイル監視開始: ${filePath}`,
          ev: startEvent,
        });
        console.error("start commentary failed:", err);
      });
  } catch (err) {
    transitionServerState("file_tail_setup_failed", "failed", {
      level: "error",
      inputMode: "file",
      detail: err instanceof Error ? err.message : String(err),
    });
    console.error("Failed to start file tail:", err);
    if (fatal) {
      process.exit(1);
    }
    throw err;
  }
}

// --- Initial Input Source Launch ---
// 入力をPTYへ（対話CLIを一応動かせる）- only for PTY mode
function handleStdinData(d: Buffer) {
  ptyManager.write(d.toString());
}

function enableStdinPassthrough(): void {
  if (stdinPassthroughEnabled || !process.stdin.isTTY) return;
  try {
    process.stdin.setRawMode(true);
  } catch {}
  process.stdin.resume();
  process.stdin.on("data", handleStdinData);
  stdinPassthroughEnabled = true;
}

function disableStdinPassthrough(): void {
  if (!stdinPassthroughEnabled || !process.stdin.isTTY) return;
  process.stdin.removeListener("data", handleStdinData);
  process.stdin.pause();
  try {
    process.stdin.setRawMode(false);
  } catch {}
  stdinPassthroughEnabled = false;
}

function stopFileTail(ignoreExitHandler: boolean): void {
  if (!fileTail) return;
  const tail = fileTail;
  if (ignoreExitHandler) {
    ignoredFileTailExit = tail;
  }
  tail.stop();
  if (fileTail === tail) {
    fileTail = null;
  }
}

function tryStartFileFallback(context: "startup" | "restart"): FileFallbackResult {
  if (fileTail) {
    return { attempted: true, activated: true, reason: "already_active" };
  }

  const decision = resolveFileFallback(INPUT_FILE, (filePath) => fs.existsSync(filePath));
  if (!decision.enabled) {
    if (context === "restart") {
      console.warn(`[WARN] File fallback unavailable (${decision.reason}). Set INPUT_FILE to a readable log file.`);
    }
    return { attempted: true, activated: false, reason: decision.reason };
  }

  try {
    disableStdinPassthrough();
    runtimeInputMode = "file";
    setupFileTail(decision.filePath);
    return { attempted: true, activated: true, reason: "activated" };
  } catch (err) {
    console.error("[ERROR] Failed to switch to file monitoring fallback:", err);
    return { attempted: true, activated: false, reason: "start_failed" };
  }
}

transitionServerState("bootstrap", "starting", { inputMode: INPUT_MODE });

if (INPUT_MODE === "pty") {
  // PTY mode: launch PTY first, then enable stdin passthrough when spawn succeeds
  const initialConfig = configFromEnv();
  try {
    runtimeInputMode = "pty";
    setupPTY(initialConfig, null);
    enableStdinPassthrough();
  } catch (err) {
    const failure = classifyPtyFailure(err, getNodePtyError());
    if (failure.kind === "ptyUnavailable") {
      markPtyUnavailable(failure.error);
      const fallback = tryStartFileFallback("startup");
      logPtyStartupFailure("startup", failure, fallback);
      if (!fallback.activated) {
        transitionServerState("startup_failed", "failed", {
          level: "warn",
          detail: `kind=${failure.kind}; fallback_reason=${fallback.reason}; error=${failure.error}`,
        });
      }
      if (fallback.activated) {
        console.warn(`[INFO] Switched to file monitoring fallback (${INPUT_FILE}) after PTY startup failure.`);
      }
      console.error("[WARN] PTY initialization failed:", ptyInitError);
      console.error("[INFO] Server will continue without PTY. Use INPUT_MODE=file for file monitoring.");
    } else {
      logPtyStartupFailure("startup", failure, NO_FILE_FALLBACK);
      transitionServerState("startup_failed", "failed", {
        level: "error",
        detail: `kind=${failure.kind}; error=${failure.error}`,
      });
      console.error("[ERROR] PTY initialization failed:", failure.error);
    }
  }
} else {
  // File mode: early validation before setupFileTail
  const decision = resolveFileFallback(INPUT_FILE, (filePath) => fs.existsSync(filePath));
  if (!decision.enabled) {
    transitionServerState("startup_failed", "failed", {
      level: "error",
      inputMode: "file",
      detail: `file_mode_invalid_config=${decision.reason}`,
    });
    if (decision.reason === "missing_input_file") {
      console.error("[ERROR] INPUT_FILE is required when INPUT_MODE=file");
    } else {
      console.error(`[ERROR] INPUT_FILE not found: ${INPUT_FILE}`);
    }
    process.exit(1);
  }
  runtimeInputMode = "file";
  setupFileTail(decision.filePath);
}

/**
 * Log startup configuration (no secrets).
 * Called after currentStyle/currentSourceMode are resolved.
 */
function logStartupConfig(): void {
  const config: Record<string, unknown> = {
    mode: runtimeInputMode,
    input_mode_raw: INPUT_MODE_RAW ?? "(unset)",
    port: PORT,
  };

  if (runtimeInputMode === "pty") {
    config.target_cmd = process.env.TARGET_CMD ?? (process.platform === "win32" ? "powershell.exe" : "bash");
    config.target_args = process.env.TARGET_ARGS_JSON ?? process.env.TARGET_ARGS ?? "";
    config.target_cwd = process.env.TARGET_CWD ?? process.cwd();
  } else {
    config.input_file = INPUT_FILE;
  }
  if (INPUT_MODE === "pty" && runtimeInputMode === "file" && ptyInitError) {
    config.fallback = "pty_unavailable_to_file";
  }

  // Safe values only (no API keys)
  config.log_source = currentSourceMode ?? "unknown";
  config.llm_provider = process.env.LLM_PROVIDER ?? "disabled";
  config.style = currentStyle ?? "unknown";

  console.log(`[startup] ${JSON.stringify(config)}`);
}

server.listen(PORT, () => {
  logStartupConfig();
  console.log(`server listening on http://localhost:${PORT} (mode: ${runtimeInputMode})`);
});

// --- Cleanup ---
function cleanup(exitCode: number = 0): void {
  if (isCleaningUp) return;
  isCleaningUp = true;
  transitionServerState("cleanup_begin", "shutting_down", { detail: `exit_code=${exitCode}` });
  console.log("\nCleaning up...");

  // 1. stdin passthrough cleanup
  disableStdinPassthrough();

  // 2. PTY kill / FileTail stop
  ptyManager.kill();
  stopFileTail(true);

  // 3. WebSocket clients close
  for (const client of wss.clients) {
    try {
      client.close();
    } catch {}
  }

  // 4. WebSocket server close + HTTP server close → 終了
  let closed = 0;

  // D-3: Keep fallback timer reference to clear on normal exit
  const fallbackTimer = setTimeout(() => {
    transitionServerState("cleanup_timeout_force_exit", "stopped", {
      level: "warn",
      detail: `exit_code=${exitCode}`,
    });
    process.exit(exitCode);
  }, 3000);

  const tryExit = () => {
    closed++;
    if (closed >= 2) {
      clearTimeout(fallbackTimer);
      transitionServerState("cleanup_complete", "stopped", { detail: `exit_code=${exitCode}` });
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
  transitionServerState("uncaught_exception", "failed", {
    level: "error",
    detail: err instanceof Error ? err.message : String(err),
  });
  console.error("Uncaught Exception:", err);
  cleanup(1);
});

process.on("unhandledRejection", (reason) => {
  transitionServerState("unhandled_rejection", "failed", {
    level: "error",
    detail: reason instanceof Error ? reason.message : String(reason),
  });
  console.error("Unhandled Rejection:", reason);
  cleanup(1);
});
