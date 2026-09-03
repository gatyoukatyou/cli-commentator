import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { isNodePtyAvailable } from "../pty/manager.js";

const canRun = process.platform !== "win32" && isNodePtyAvailable();
// Ignores SIGINT entirely, so writeInput("\u0003") cannot end it. SIGHUP can.
const STUBBORN_CLI_SCRIPT =
  "process.on('SIGINT', () => {}); console.log('stubborn-ready'); setInterval(() => {}, 1000)";

type ServerMessage = {
  kind?: string;
  ev?: { type?: string; summary?: string };
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to resolve a free port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

async function isHealthy(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const request = http.get(
      { host: "127.0.0.1", port, path: "/healthz", timeout: 300 },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForHealth(port: number, child: ChildProcess): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before health check with code ${child.exitCode}`);
    }
    if (await isHealthy(port)) return;
    await delay(50);
  }
  throw new Error("Server health check timed out");
}

async function waitForMessage(
  messages: ServerMessage[],
  predicate: (message: ServerMessage) => boolean,
): Promise<ServerMessage> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    const message = messages.find(predicate);
    if (message) return message;
    await delay(50);
  }
  throw new Error("Timed out waiting for WebSocket message");
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
  }
  await Promise.race([
    new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve({ code: child.exitCode, signal: child.signalCode });
        return;
      }
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }),
    delay(5_000),
  ]);
}

async function startServer(): Promise<{ child: ChildProcess; port: number; stdout: () => string }> {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLI_COMMENTATOR_PORT: String(port),
      CLI_COMMENTATOR_MANAGED_SERVER: "1",
      INPUT_MODE: "pty",
      TARGET_CMD: process.execPath,
      TARGET_ARGS_JSON: JSON.stringify(["-e", STUBBORN_CLI_SCRIPT]),
      TARGET_CWD: process.cwd(),
      LLM_PROVIDER: "disabled",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });
  await waitForHealth(port, child);
  return { child, port, stdout: () => output };
}

async function connect(port: number): Promise<{ ws: WebSocket; messages: ServerMessage[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}?clientId=test-client&clientKind=web`);
  const messages: ServerMessage[] = [];
  ws.on("message", (data) => {
    messages.push(JSON.parse(data.toString()) as ServerMessage);
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return { ws, messages };
}

describe.skipIf(!canRun)("stopSession force-stop lifecycle", () => {
  it("stops a CLI that ignores Ctrl+C, keeps the server alive, and allows relaunch", async () => {
    const { child, port, stdout } = await startServer();
    const { ws, messages } = await connect(port);

    try {
      await delay(300);

      // Ctrl+C alone must not end a session whose CLI ignores SIGINT
      ws.send(JSON.stringify({ kind: "writeInput", data: "\u0003" }));
      await delay(500);
      expect(messages.some((message) => message.kind === "event" && message.ev?.type === "done")).toBe(false);

      // stopSession ends the session
      messages.length = 0;
      ws.send(JSON.stringify({ kind: "stopSession" }));
      const done = await waitForMessage(
        messages,
        (message) => message.kind === "event" && message.ev?.type === "done",
      );
      expect(done.ev?.summary).toContain("signal");

      // Desktop Server stays alive and WebSocket stays open
      expect(child.exitCode).toBeNull();
      expect(await isHealthy(port)).toBe(true);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      // A second stopSession while no PTY is running is a harmless no-op
      ws.send(JSON.stringify({ kind: "stopSession" }));
      await delay(300);
      expect(await isHealthy(port)).toBe(true);

      // The next Start relaunches a session
      messages.length = 0;
      ws.send(
        JSON.stringify({
          kind: "launchSession",
          session: {
            name: "stubborn CLI",
            cmd: process.execPath,
            args: ["-e", STUBBORN_CLI_SCRIPT],
            cwd: process.cwd(),
            style: "standard",
            logSource: "generic",
          },
        }),
      );
      try {
        await waitForMessage(messages, (message) => message.kind === "event" && message.ev?.type === "start");
      } catch (err) {
        throw new Error(`relaunch failed; server output:\n${stdout()}\nmessages: ${JSON.stringify(messages)}`, { cause: err });
      }
      expect(await isHealthy(port)).toBe(true);

      // Cleanup: end the relaunched session so the child process does not linger
      ws.send(JSON.stringify({ kind: "stopSession" }));
      try {
        await waitForMessage(messages, (message) => message.kind === "event" && message.ev?.type === "done");
      } catch (err) {
        throw new Error(`cleanup stop failed; server output:\n${stdout()}\nmessages: ${JSON.stringify(messages)}`, { cause: err });
      }
    } finally {
      ws.close();
      await stopServer(child);
    }
  }, 20_000);
});
