import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { isNodePtyAvailable } from "../pty/manager.js";

const canRun = process.platform !== "win32" && isNodePtyAvailable();

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

async function waitForHealth(port: number, child: ChildProcess): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before health check with code ${child.exitCode}`);
    }

    const healthy = await new Promise<boolean>((resolve) => {
      const request = http.get(
        { host: "127.0.0.1", port, path: "/healthz", timeout: 300 },
        (response) => {
          response.resume();
          resolve(response.statusCode === 200);
        }
      );
      request.on("error", () => resolve(false));
      request.on("timeout", () => {
        request.destroy();
        resolve(false);
      });
    });
    if (healthy) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Server health check timed out");
}

async function waitForOutput(getOutput: () => string, pattern: RegExp): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    const output = getOutput();
    if (pattern.test(output)) return output;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`PTY output did not match ${pattern}: ${JSON.stringify(getOutput())}`);
}

describe.skipIf(!canRun)("PTY resize WebSocket integration", () => {
  it("applies browser dimensions to the managed PTY", async () => {
    const port = await getFreePort();
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLI_COMMENTATOR_PORT: String(port),
        INPUT_MODE: "pty",
        TARGET_CMD: "bash",
        TARGET_ARGS_JSON: JSON.stringify(["--noprofile", "--norc"]),
        TARGET_CWD: process.cwd(),
        LLM_PROVIDER: "disabled",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    let ws: WebSocket | null = null;
    const receivedKinds: string[] = [];

    try {
      await waitForHealth(port, child);
      ws = new WebSocket(`ws://127.0.0.1:${port}`);
      let rawOutput = "";
      ws.on("message", (data) => {
        const message = JSON.parse(data.toString()) as { kind?: string; data?: unknown };
        if (message.kind) receivedKinds.push(message.kind);
        if (message.kind === "raw" && typeof message.data === "string") {
          rawOutput += message.data;
        }
      });

      await new Promise<void>((resolve, reject) => {
        ws?.once("open", resolve);
        ws?.once("error", reject);
      });

      await waitForOutput(() => receivedKinds.join(","), /(?:^|,)hello(?:,|$)/);

      ws.send(JSON.stringify({ kind: "resizePty", cols: 96, rows: 32 }));
      ws.send(JSON.stringify({ kind: "writeInput", data: "stty size\r" }));

      const output = await waitForOutput(() => rawOutput, /32\s+96/);
      expect(output).toMatch(/32\s+96/);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nstdout=${stdout}\nstderr=${stderr}\nmessages=${receivedKinds.join(",")}`
      );
    } finally {
      ws?.close();
      child.kill("SIGTERM");
    }
  }, 15_000);
});
