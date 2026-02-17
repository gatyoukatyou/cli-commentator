import { describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

type WsMessage = Record<string, unknown> & { kind?: string };
type StartupFailureLog = {
  context?: string;
  kind?: string;
  code?: string;
  fallback?: {
    attempted?: boolean;
    activated?: boolean;
    reason?: string;
  };
};
type ServerStateLog = {
  trigger?: string;
  from?: string;
  to?: string;
  inputMode?: string;
  profileId?: string | null;
  detail?: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to resolve free port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs: number,
  timeoutMessage: string | (() => string)
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error(typeof timeoutMessage === "function" ? timeoutMessage() : timeoutMessage);
}

async function waitForHealth(
  port: number,
  child: ChildProcess,
  getSpawnError: () => Error | null
): Promise<void> {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    const spawnError = getSpawnError();
    if (spawnError) {
      throw new Error(`Server process failed to spawn: ${spawnError.message}\nstdout=${stdout}\nstderr=${stderr}`);
    }
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with code ${child.exitCode}\nstdout=${stdout}\nstderr=${stderr}`);
    }

    const healthy = await new Promise<boolean>((resolve) => {
      const req = http.get(
        {
          host: "127.0.0.1",
          port,
          path: "/healthz",
          timeout: 500,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    });

    if (healthy) {
      return;
    }
    await sleep(200);
  }

  throw new Error(`Server health check timeout. stdout=${stdout}\nstderr=${stderr}`);
}

async function waitForMessage(
  messages: WsMessage[],
  predicate: (message: WsMessage) => boolean,
  timeoutMs: number,
  timeoutMessage: string
): Promise<WsMessage> {
  await waitFor(
    () => messages.some(predicate),
    timeoutMs,
    50,
    timeoutMessage
  );
  return messages.find(predicate)!;
}

async function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
  timeoutMessage: string
): Promise<number | null> {
  if (child.exitCode !== null) {
    return child.exitCode;
  }

  return await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function parseStartupFailureLogs(stderrOutput: string): StartupFailureLog[] {
  const prefix = "[startup/failure] ";
  return stderrOutput
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix))
    .flatMap((line) => {
      try {
        return [JSON.parse(line.slice(prefix.length)) as StartupFailureLog];
      } catch {
        return [];
      }
    });
}

function parseServerStateLogs(output: string): ServerStateLog[] {
  const prefix = "[server/state-event] ";
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix))
    .flatMap((line) => {
      try {
        return [JSON.parse(line.slice(prefix.length)) as ServerStateLog];
      } catch {
        return [];
      }
    });
}

describe("windows fallback integration", () => {
  const itRequiresNodePty = process.platform === "win32" ? it.skip : it;
  it("emits ptyUnavailable on startup and on profile restart, without ptyError", async () => {
    const port = await getFreePort();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-commentator-fallback-it-"));
    const inputFile = path.join(tmpDir, "input.log");
    const xdgConfigHome = path.join(tmpDir, "xdg");
    await fs.mkdir(xdgConfigHome, { recursive: true });
    await fs.writeFile(inputFile, "seed line\n", "utf-8");

    const child = spawn("node", ["--import", "tsx", "src/index.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLI_COMMENTATOR_FORCE_NO_PTY: "1",
        INPUT_MODE: "pty",
        INPUT_FILE: inputFile,
        CLI_COMMENTATOR_PORT: String(port),
        XDG_CONFIG_HOME: xdgConfigHome,
        LLM_PROVIDER: "disabled",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let spawnError: Error | null = null;
    child.on("error", (err) => {
      spawnError = err;
    });
    let stdoutOutput = "";
    child.stdout?.on("data", (chunk) => {
      stdoutOutput += chunk.toString();
    });
    let stderrOutput = "";
    child.stderr?.on("data", (chunk) => {
      stderrOutput += chunk.toString();
    });

    const messages: WsMessage[] = [];
    let ws: WebSocket | null = null;

    try {
      await waitForHealth(port, child, () => spawnError);
      ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on("message", (raw) => {
        try {
          const message = JSON.parse(raw.toString()) as WsMessage;
          messages.push(message);
        } catch {
          // Ignore malformed message
        }
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws?.close();
          reject(new Error("WebSocket connection timeout"));
        }, 5000);
        ws?.on("open", () => {
          clearTimeout(timer);
          resolve();
        });
        ws?.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      const startupUnavailable = await waitForMessage(
        messages,
        (m) => m.kind === "ptyUnavailable",
        10000,
        "Did not receive startup ptyUnavailable message"
      );
      expect(startupUnavailable.error).toBeTypeOf("string");
      expect(String(startupUnavailable.error)).toContain("CLI_COMMENTATOR_FORCE_NO_PTY");
      expect(startupUnavailable.suggestion).toBeTypeOf("string");
      expect(String(startupUnavailable.suggestion)).toContain("INPUT_MODE=file");
      await waitFor(
        () =>
          parseStartupFailureLogs(stderrOutput).some(
            (log) =>
              log.context === "startup" &&
              log.kind === "ptyUnavailable" &&
              log.code === "node_pty_unavailable" &&
              log.fallback?.reason === "activated" &&
              log.fallback?.activated === true
          ),
        10000,
        50,
        "Did not observe structured startup failure log for startup fallback"
      );
      await waitFor(
        () =>
          parseServerStateLogs(`${stdoutOutput}\n${stderrOutput}`).some(
            (log) =>
              log.trigger === "file_tail_started" &&
              log.from === "starting" &&
              log.to === "file_running" &&
              log.inputMode === "file"
          ),
        10000,
        50,
        "Did not observe state transition to file_running during startup fallback"
      );

      ws.send(
        JSON.stringify({
          kind: "saveProfile",
          profile: {
            name: "fallback-it-profile",
            cmd: "echo",
            args: ["hello"],
            style: "kansai",
            logSource: "auto",
          },
        })
      );

      const saved = await waitForMessage(
        messages,
        (m) => m.kind === "profileSaved",
        10000,
        "Did not receive profileSaved message"
      );
      const profile = (saved.profile as Record<string, unknown>) ?? null;
      const profileId = typeof profile?.id === "string" ? profile.id : null;
      expect(profileId).toBeTruthy();

      const checkpoint = messages.length;
      ws.send(JSON.stringify({ kind: "setActiveProfile", id: profileId }));

      await waitFor(
        () => messages.slice(checkpoint).some((m) => m.kind === "ptyUnavailable"),
        10000,
        50,
        "Did not receive ptyUnavailable after setActiveProfile"
      );

      await waitFor(
        () =>
          messages.slice(checkpoint).some((m) => {
            if (m.kind !== "event") return false;
            const ev = (m.ev as Record<string, unknown>) ?? null;
            return typeof ev?.detail === "string" && ev.detail.includes("tail -f");
          }),
        10000,
        50,
        "Did not observe file tail start event after fallback"
      );
      await waitFor(
        () =>
          parseStartupFailureLogs(stderrOutput).some(
            (log) =>
              log.context === "restart" &&
              log.kind === "ptyUnavailable" &&
              log.code === "node_pty_unavailable" &&
              log.fallback?.reason === "activated" &&
              log.fallback?.activated === true
          ),
        10000,
        50,
        "Did not observe structured startup failure log for restart fallback"
      );
      await waitFor(
        () =>
          parseServerStateLogs(`${stdoutOutput}\n${stderrOutput}`).some(
            (log) =>
              (log.trigger === "restart_fallback_file" || log.trigger === "file_tail_started") &&
              log.from === "restarting" &&
              log.to === "file_running" &&
              log.inputMode === "file"
          ),
        10000,
        50,
        "Did not observe state transition to file_running during restart fallback"
      );

      const ptyErrorAfterRestart = messages.slice(checkpoint).find((m) => m.kind === "ptyError");
      expect(ptyErrorAfterRestart).toBeUndefined();
    } finally {
      if (ws) {
        ws.close();
      }
      await stopChild(child);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 30000);

  it("emits ptyUnavailable on startup and restart when file fallback is unavailable", async () => {
    const port = await getFreePort();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-commentator-fallback-no-file-it-"));
    const missingInputFile = path.join(tmpDir, "missing.log");
    const xdgConfigHome = path.join(tmpDir, "xdg");
    await fs.mkdir(xdgConfigHome, { recursive: true });

    const child = spawn("node", ["--import", "tsx", "src/index.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLI_COMMENTATOR_FORCE_NO_PTY: "1",
        INPUT_MODE: "pty",
        INPUT_FILE: missingInputFile,
        CLI_COMMENTATOR_PORT: String(port),
        XDG_CONFIG_HOME: xdgConfigHome,
        LLM_PROVIDER: "disabled",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let spawnError: Error | null = null;
    child.on("error", (err) => {
      spawnError = err;
    });
    let stdoutOutput = "";
    child.stdout?.on("data", (chunk) => {
      stdoutOutput += chunk.toString();
    });
    let stderrOutput = "";
    child.stderr?.on("data", (chunk) => {
      stderrOutput += chunk.toString();
    });

    const messages: WsMessage[] = [];
    let ws: WebSocket | null = null;

    try {
      await waitForHealth(port, child, () => spawnError);
      ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on("message", (raw) => {
        try {
          messages.push(JSON.parse(raw.toString()) as WsMessage);
        } catch {
          // Ignore malformed message
        }
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws?.close();
          reject(new Error("WebSocket connection timeout"));
        }, 5000);
        ws?.on("open", () => {
          clearTimeout(timer);
          resolve();
        });
        ws?.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      const startupUnavailable = await waitForMessage(
        messages,
        (m) => m.kind === "ptyUnavailable",
        10000,
        "Did not receive startup ptyUnavailable message"
      );
      expect(String(startupUnavailable.error)).toContain("CLI_COMMENTATOR_FORCE_NO_PTY");
      expect(String(startupUnavailable.suggestion)).toContain("INPUT_MODE=file");
      await waitFor(
        () =>
          parseStartupFailureLogs(stderrOutput).some(
            (log) =>
              log.context === "startup" &&
              log.kind === "ptyUnavailable" &&
              log.code === "node_pty_unavailable" &&
              log.fallback?.reason === "file_not_found" &&
              log.fallback?.activated === false
          ),
        10000,
        50,
        "Did not observe structured startup failure log for missing INPUT_FILE on startup"
      );
      await waitFor(
        () =>
          parseServerStateLogs(`${stdoutOutput}\n${stderrOutput}`).some(
            (log) =>
              log.trigger === "startup_failed" &&
              log.from === "starting" &&
              log.to === "failed"
          ),
        10000,
        50,
        "Did not observe state transition to failed during startup without fallback"
      );

      const startupPtyError = messages.find((m) => m.kind === "ptyError");
      expect(startupPtyError).toBeUndefined();

      ws.send(
        JSON.stringify({
          kind: "saveProfile",
          profile: {
            name: "fallback-no-file-it-profile",
            cmd: "echo",
            args: ["hello"],
            style: "kansai",
            logSource: "auto",
          },
        })
      );

      const saved = await waitForMessage(
        messages,
        (m) => m.kind === "profileSaved",
        10000,
        "Did not receive profileSaved message"
      );
      const profile = (saved.profile as Record<string, unknown>) ?? null;
      const profileId = typeof profile?.id === "string" ? profile.id : null;
      expect(profileId).toBeTruthy();

      const checkpoint = messages.length;
      ws.send(JSON.stringify({ kind: "setActiveProfile", id: profileId }));

      await waitFor(
        () => messages.slice(checkpoint).some((m) => m.kind === "ptyUnavailable"),
        10000,
        50,
        "Did not receive ptyUnavailable after setActiveProfile"
      );

      await waitFor(
        () => messages.slice(checkpoint).some((m) => m.kind === "ptyRestart"),
        10000,
        50,
        "Did not receive ptyRestart after setActiveProfile"
      );

      const ptyErrorAfterRestart = messages.slice(checkpoint).find((m) => m.kind === "ptyError");
      expect(ptyErrorAfterRestart).toBeUndefined();
      await waitFor(
        () =>
          parseStartupFailureLogs(stderrOutput).some(
            (log) =>
              log.context === "restart" &&
              log.kind === "ptyUnavailable" &&
              log.code === "node_pty_unavailable" &&
              log.fallback?.reason === "file_not_found" &&
              log.fallback?.activated === false
          ),
        10000,
        50,
        "Did not observe structured startup failure log for missing INPUT_FILE on restart"
      );
      await waitFor(
        () =>
          parseServerStateLogs(`${stdoutOutput}\n${stderrOutput}`).some(
            (log) =>
              log.trigger === "restart_failed" &&
              log.from === "restarting" &&
              log.to === "failed"
          ),
        10000,
        50,
        "Did not observe state transition to failed during restart without fallback"
      );

      const fileTailStartAfterRestart = messages.slice(checkpoint).find((m) => {
        if (m.kind !== "event") return false;
        const ev = (m.ev as Record<string, unknown>) ?? null;
        return typeof ev?.detail === "string" && ev.detail.includes("tail -f");
      });
      expect(fileTailStartAfterRestart).toBeUndefined();
    } finally {
      if (ws) {
        ws.close();
      }
      await stopChild(child);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 30000);

  it("logs startup_failed and exits when file mode starts without INPUT_FILE", async () => {
    const port = await getFreePort();

    const child = spawn("node", ["--import", "tsx", "src/index.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        INPUT_MODE: "file",
        INPUT_FILE: "",
        CLI_COMMENTATOR_PORT: String(port),
        LLM_PROVIDER: "disabled",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutOutput = "";
    child.stdout?.on("data", (chunk) => {
      stdoutOutput += chunk.toString();
    });
    let stderrOutput = "";
    child.stderr?.on("data", (chunk) => {
      stderrOutput += chunk.toString();
    });

    const exitCode = await waitForChildExit(
      child,
      10000,
      "Server did not exit for invalid file mode startup configuration"
    );
    expect(exitCode).toBe(1);

    const startupFailure = parseServerStateLogs(`${stdoutOutput}\n${stderrOutput}`).find(
      (log) =>
        log.trigger === "startup_failed" &&
        log.from === "starting" &&
        log.to === "failed" &&
        log.inputMode === "file"
    );
    expect(startupFailure).toBeTruthy();
    expect(String(startupFailure?.detail ?? "")).toContain("file_mode_invalid_config=missing_input_file");
    expect(`${stdoutOutput}\n${stderrOutput}`).toContain("INPUT_FILE is required when INPUT_MODE=file");
  }, 10000);

  itRequiresNodePty("emits ptyError and structured restart failure logs when profile args are invalid", async () => {
    const port = await getFreePort();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-commentator-restart-failure-it-"));
    const xdgConfigHome = path.join(tmpDir, "xdg");
    await fs.mkdir(xdgConfigHome, { recursive: true });

    const child = spawn("node", ["--import", "tsx", "src/index.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        INPUT_MODE: "pty",
        TARGET_CMD: process.execPath,
        TARGET_ARGS_JSON: JSON.stringify(["-e", "setInterval(() => {}, 1000)"]),
        CLI_COMMENTATOR_PORT: String(port),
        XDG_CONFIG_HOME: xdgConfigHome,
        LLM_PROVIDER: "disabled",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let spawnError: Error | null = null;
    child.on("error", (err) => {
      spawnError = err;
    });
    let stdoutOutput = "";
    child.stdout?.on("data", (chunk) => {
      stdoutOutput += chunk.toString();
    });
    let stderrOutput = "";
    child.stderr?.on("data", (chunk) => {
      stderrOutput += chunk.toString();
    });

    const messages: WsMessage[] = [];
    let ws: WebSocket | null = null;

    try {
      await waitForHealth(port, child, () => spawnError);
      ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on("message", (raw) => {
        try {
          messages.push(JSON.parse(raw.toString()) as WsMessage);
        } catch {
          // Ignore malformed message
        }
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws?.close();
          reject(new Error("WebSocket connection timeout"));
        }, 5000);
        ws?.on("open", () => {
          clearTimeout(timer);
          resolve();
        });
        ws?.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      ws.send(
        JSON.stringify({
          kind: "saveProfile",
          profile: {
            name: "restart-failure-it-profile",
            cmd: process.execPath,
            args: "invalid-args",
            style: "kansai",
            logSource: "auto",
          },
        })
      );

      const saved = await waitForMessage(
        messages,
        (m) => m.kind === "profileSaved",
        10000,
        "Did not receive profileSaved message"
      );
      const profile = (saved.profile as Record<string, unknown>) ?? null;
      const profileId = typeof profile?.id === "string" ? profile.id : null;
      expect(profileId).toBeTruthy();

      const checkpoint = messages.length;
      ws.send(JSON.stringify({ kind: "setActiveProfile", id: profileId }));

      await waitFor(
        () => messages.slice(checkpoint).some((m) => m.kind === "ptyRestart"),
        10000,
        50,
        "Did not receive ptyRestart after setActiveProfile"
      );

      await waitFor(
        () => messages.slice(checkpoint).some((m) => m.kind === "ptyError"),
        10000,
        50,
        () =>
          `Did not receive ptyError after restart with invalid args. kinds=${messages
            .slice(checkpoint)
            .map((m) => String(m.kind ?? "unknown"))
            .join(",")} stderr_tail=${stderrOutput.slice(-500)}`
      );
      const restartError = messages.slice(checkpoint).find((m) => m.kind === "ptyError");
      expect(restartError).toBeTruthy();
      expect(restartError?.error).toBeTypeOf("string");
      expect(String(restartError?.error ?? "").length).toBeGreaterThan(0);

      const ptyUnavailableAfterRestart = messages.slice(checkpoint).find((m) => m.kind === "ptyUnavailable");
      expect(ptyUnavailableAfterRestart).toBeUndefined();

      await waitFor(
        () =>
          parseStartupFailureLogs(stderrOutput).some(
            (log) =>
              log.context === "restart" &&
              log.kind === "ptyError" &&
              log.code !== "node_pty_unavailable" &&
              log.fallback?.attempted === false &&
              log.fallback?.activated === false &&
              log.fallback?.reason === "not_attempted"
          ),
        10000,
        50,
        "Did not observe structured restart failure log for invalid profile args"
      );

      const restartFailureLog = parseStartupFailureLogs(stderrOutput).find(
        (log) => log.context === "restart" && log.kind === "ptyError"
      );
      expect(restartFailureLog?.code).toBe("unknown");

      await waitFor(
        () =>
          parseServerStateLogs(`${stdoutOutput}\n${stderrOutput}`).some(
            (log) =>
              log.trigger === "restart_failed" &&
              log.from === "restarting" &&
              log.to === "failed" &&
              typeof log.detail === "string" &&
              log.detail.includes("kind=ptyError")
          ),
        10000,
        50,
        "Did not observe state transition to failed during restart ptyError"
      );

      const fileFallbackStateAfterRestart = parseServerStateLogs(`${stdoutOutput}\n${stderrOutput}`).find(
        (log) => log.from === "restarting" && log.to === "file_running"
      );
      expect(fileFallbackStateAfterRestart).toBeUndefined();
    } finally {
      if (ws) {
        ws.close();
      }
      await stopChild(child);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 30000);
});
