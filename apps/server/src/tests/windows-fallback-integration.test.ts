import { describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

type WsMessage = Record<string, unknown> & { kind?: string };

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

describe("windows fallback integration", () => {
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
});
