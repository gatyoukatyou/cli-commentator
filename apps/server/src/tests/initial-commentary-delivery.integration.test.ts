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
  ev?: { type?: string; summary?: string; detail?: string };
  narration?: string;
  explanation?: string;
  speech?: { disposition?: string; text?: string };
  meta?: { narrationProvider?: string };
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      if (!address || typeof address === "string") {
        listener.close();
        reject(new Error("Failed to resolve a free port"));
        return;
      }
      listener.close(() => resolve(address.port));
    });
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
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    if (messages.some(predicate)) return;
    await delay(25);
  }
  throw new Error("Timed out waiting for WebSocket message");
}

async function startServer(options: { provider: "disabled" | "mock"; failCommentary?: boolean }): Promise<{
  child: ChildProcess;
  port: number;
}> {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLI_COMMENTATOR_PORT: String(port),
      CLI_COMMENTATOR_MANAGED_SERVER: "1",
      INPUT_MODE: "pty",
      TARGET_CMD: process.execPath,
      TARGET_ARGS_JSON: JSON.stringify(["-e", MOCK_CLI_SCRIPT]),
      TARGET_CWD: process.cwd(),
      LLM_PROVIDER: options.provider,
      MOCK_LLM_MODE: options.failCommentary ? "error" : undefined,
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  await waitForHealth(port, child);
  return { child, port };
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5_000),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function connect(port: number): Promise<{ ws: WebSocket; messages: ServerMessage[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
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

function startEvents(messages: ServerMessage[]): ServerMessage[] {
  return messages.filter((message) => message.kind === "event" && message.ev?.type === "start");
}

function startCommentaries(messages: ServerMessage[]): ServerMessage[] {
  return messages.filter((message) => message.kind === "commentary" && message.ev?.type === "start");
}

function expectStartCommentary(message: ServerMessage, provider?: string): void {
  expect(message.narration).toBeTypeOf("string");
  expect(message.narration?.trim()).not.toBe("");
  expect(message.explanation).toBeTypeOf("string");
  expect(message.explanation?.trim()).not.toBe("");
  expect(message.speech?.disposition).toBe("speak");
  expect(message.speech?.text).toBeTypeOf("string");
  expect(message.speech?.text?.trim()).not.toBe("");
  if (provider) expect(message.meta?.narrationProvider).toBe(provider);
}

describe.skipIf(!canRun)("initial managed PTY commentary delivery", () => {
  it("delivers the pre-connection start pair once and preserves connected restart delivery", async () => {
    const { child, port } = await startServer({ provider: "disabled" });
    let ws: WebSocket | undefined;
    let reconnect: WebSocket | undefined;
    try {
      const first = await connect(port);
      ws = first.ws;
      await waitForMessage(first.messages, (message) => message.kind === "commentary" && message.ev?.type === "start");

      expect(startEvents(first.messages)).toHaveLength(1);
      expect(startCommentaries(first.messages)).toHaveLength(1);
      expectStartCommentary(startCommentaries(first.messages)[0]);

      ws.close();
      await delay(100);
      const second = await connect(port);
      reconnect = second.ws;
      await delay(300);
      expect(startEvents(second.messages)).toHaveLength(0);
      expect(startCommentaries(second.messages)).toHaveLength(0);

      second.ws.send(JSON.stringify({
        kind: "launchSession",
        session: {
          name: "mock CLI restart",
          cmd: process.execPath,
          args: ["-e", MOCK_CLI_SCRIPT],
          cwd: process.cwd(),
          style: "kansai",
          logSource: "generic",
        },
      }));
      await waitForMessage(second.messages, (message) => message.kind === "commentary" && message.ev?.type === "start");

      expect(startEvents(second.messages)).toHaveLength(1);
      expect(startCommentaries(second.messages)).toHaveLength(1);
      expectStartCommentary(startCommentaries(second.messages)[0]);
    } finally {
      ws?.close();
      reconnect?.close();
      await stopServer(child);
    }
  }, 25_000);

  it("delivers one rules fallback with a voice payload when commentary generation fails", async () => {
    const { child, port } = await startServer({ provider: "mock", failCommentary: true });
    let ws: WebSocket | undefined;
    try {
      const connected = await connect(port);
      ws = connected.ws;
      await waitForMessage(connected.messages, (message) => message.kind === "commentary" && message.ev?.type === "start");

      expect(startEvents(connected.messages)).toHaveLength(1);
      expect(startCommentaries(connected.messages)).toHaveLength(1);
      expectStartCommentary(startCommentaries(connected.messages)[0], "rules");
    } finally {
      ws?.close();
      await stopServer(child);
    }
  }, 20_000);
});
