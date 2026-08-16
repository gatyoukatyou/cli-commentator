import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { isNodePtyAvailable } from "../pty/manager.js";

const canRun = process.platform !== "win32" && isNodePtyAvailable();
const MOCK_CLI_SCRIPT =
  "process.on('SIGINT', () => process.exit(130)); console.log('mock-ready'); setInterval(() => {}, 1000)";

type ServerMessage = {
  kind?: string;
  ev?: { type?: string };
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

async function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return await new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
  }
  await Promise.race([waitForExit(child), delay(5_000)]);
}

async function startServer(managed: boolean): Promise<{
  child: ChildProcess;
  port: number;
  stdout: () => string;
}> {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLI_COMMENTATOR_PORT: String(port),
      CLI_COMMENTATOR_MANAGED_SERVER: managed ? "1" : undefined,
      INPUT_MODE: "pty",
      TARGET_CMD: process.execPath,
      TARGET_ARGS_JSON: JSON.stringify(["-e", MOCK_CLI_SCRIPT]),
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

describe.skipIf(!canRun)("managed terminal interrupt lifecycle", () => {
  it("keeps the managed server and WebSocket alive, releases the PTY, and relaunches it", async () => {
    const { child, port, stdout } = await startServer(true);
    const { ws, messages } = await connect(port);

    try {
      await delay(300);
      ws.send(JSON.stringify({ kind: "writeInput", data: "\u0003" }));
      await waitForMessage(messages, (message) => message.kind === "event" && message.ev?.type === "done");
      expect(messages.filter((message) => message.kind === "event" && message.ev?.type === "done")).toHaveLength(1);

      expect(child.exitCode).toBeNull();
      expect(await isHealthy(port)).toBe(true);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      expect(stdout()).not.toContain("cleanup_begin");

      messages.length = 0;
      ws.send(
        JSON.stringify({
          kind: "launchSession",
          session: {
            name: "mock CLI",
            cmd: process.execPath,
            args: ["-e", MOCK_CLI_SCRIPT],
            cwd: process.cwd(),
            style: "kansai",
            logSource: "generic",
          },
        }),
      );
      await waitForMessage(messages, (message) => message.kind === "ptyRestart");
      await waitForMessage(messages, (message) => message.kind === "event" && message.ev?.type === "start");
      expect(await isHealthy(port)).toBe(true);

      await delay(300);
      ws.send(JSON.stringify({ kind: "writeInput", data: "\u0003" }));
      await waitForMessage(messages, (message) => message.kind === "event" && message.ev?.type === "done");
      expect(messages.filter((message) => message.kind === "event" && message.ev?.type === "done")).toHaveLength(1);
    } finally {
      ws.close();
      await stopServer(child);
    }
  }, 20_000);

  it("keeps standalone cleanup behavior for the same foreground exit", async () => {
    const { child, port } = await startServer(false);
    const { ws, messages } = await connect(port);

    try {
      await delay(300);
      ws.send(JSON.stringify({ kind: "writeInput", data: "\u0003" }));
      const exit = await waitForExit(child);

      expect(exit.code).toBe(130);
      expect(await isHealthy(port)).toBe(false);
    } finally {
      ws.close();
      await stopServer(child);
      expect(messages.some((message) => message.kind === "event" && message.ev?.type === "done")).toBe(true);
    }
  }, 20_000);
});
