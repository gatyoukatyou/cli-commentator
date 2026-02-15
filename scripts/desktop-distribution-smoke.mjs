#!/usr/bin/env node

import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const bundleRoot = path.join(
  repoRoot,
  "apps",
  "desktop",
  "src-tauri",
  "target",
  "release",
  "bundle"
);

function log(message) {
  console.log(`[desktop-smoke] ${message}`);
}

function walkAppBundles(rootDir) {
  const found = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !existsSync(current)) continue;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.name.endsWith(".app")) {
        found.push(fullPath);
      } else {
        stack.push(fullPath);
      }
    }
  }
  return found.sort();
}

function sidecarRootFromManifest(manifestPath) {
  const manifestDir = path.dirname(manifestPath);
  if (path.basename(manifestDir) === "resources") {
    return path.dirname(manifestDir);
  }
  return manifestDir;
}

function uniquePaths(candidates) {
  return [...new Set(candidates.map((candidate) => path.normalize(candidate)))];
}

function resolveNodeBinaryPath(sidecarRoot, manifestNodeBinary, appBundlePath) {
  const macOsDir = path.join(appBundlePath, "Contents", "MacOS");
  const manifestNodeName = path.basename(manifestNodeBinary);
  const fallbackNodeName = process.platform === "win32" ? "node.exe" : "node";
  const candidates = uniquePaths([
    path.join(sidecarRoot, manifestNodeBinary),
    path.join(macOsDir, manifestNodeName),
    path.join(macOsDir, fallbackNodeName),
  ]);
  const existing = candidates.find((candidate) => existsSync(candidate));
  if (!existing) {
    throw new Error(`Bundled node binary is missing. candidates=${candidates.join(",")}`);
  }
  return existing;
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to reserve an ephemeral port"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitForHealth(port, timeoutMs) {
  const healthUrl = `http://127.0.0.1:${port}/healthz`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`Health check timed out: ${healthUrl}`);
}

function decodeWsMessage(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  return "";
}

async function getWebSocketConstructor() {
  if (typeof WebSocket === "function") {
    return WebSocket;
  }

  const wsModule = await import("ws");
  const WebSocketCtor = wsModule.WebSocket ?? wsModule.default;
  if (typeof WebSocketCtor !== "function") {
    throw new Error("WebSocket implementation is unavailable");
  }
  return WebSocketCtor;
}

async function waitForCommentary(port, timeoutMs) {
  const WebSocketCtor = await getWebSocketConstructor();

  return await new Promise((resolve, reject) => {
    const ws = new WebSocketCtor(`ws://127.0.0.1:${port}`);
    const addListener = (event, handler) => {
      if (typeof ws.addEventListener === "function") {
        ws.addEventListener(event, handler);
        return;
      }
      if (typeof ws.on === "function") {
        if (event === "message") {
          ws.on("message", (data) => handler({ data }));
        } else if (event === "error") {
          ws.on("error", (error) => handler(error));
        } else {
          ws.on(event, handler);
        }
      }
    };
    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error("Timed out waiting for commentary event over WebSocket"));
    }, timeoutMs);

    addListener("error", (event) => {
      clearTimeout(timeout);
      const errorText =
        event instanceof Error
          ? event.message
          : String(event?.type ?? event?.message ?? "unknown");
      reject(new Error(`WebSocket error: ${errorText}`));
    });

    addListener("message", (event) => {
      const payloadData = event?.data ?? event;
      const text = decodeWsMessage(payloadData);
      if (!text) return;
      try {
        const payload = JSON.parse(text);
        if (payload?.kind === "commentary" && typeof payload?.text === "string" && payload.text.trim()) {
          clearTimeout(timeout);
          try {
            ws.close();
          } catch {}
          resolve(payload.text.trim());
        }
      } catch {}
    });
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  try {
    await Promise.race([once(child, "exit"), delay(3000)]);
  } catch {}
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    try {
      await once(child, "exit");
    } catch {}
  }
}

async function main() {
  if (!existsSync(bundleRoot)) {
    throw new Error(`Desktop bundle directory is missing: ${bundleRoot}`);
  }

  const appBundles = walkAppBundles(bundleRoot);
  if (appBundles.length === 0) {
    throw new Error(`No .app bundle found under: ${bundleRoot}`);
  }
  const sourceAppBundle = appBundles[0];
  log(`Found app bundle: ${path.relative(repoRoot, sourceAppBundle)}`);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "cli-commentator-desktop-smoke-"));
  const installRoot = path.join(tempRoot, "Applications");
  mkdirSync(installRoot, { recursive: true });
  const installedAppBundle = path.join(installRoot, path.basename(sourceAppBundle));
  cpSync(sourceAppBundle, installedAppBundle, { recursive: true });
  log(`Installed app bundle into temp root: ${installedAppBundle}`);

  const resourcesDir = path.join(installedAppBundle, "Contents", "Resources");
  const manifestCandidates = [
    path.join(resourcesDir, "resources", "sidecar-manifest.json"),
    path.join(resourcesDir, "sidecar-manifest.json"),
  ];
  const manifestPath = manifestCandidates.find((candidate) => existsSync(candidate));
  if (!manifestPath) {
    throw new Error(`sidecar-manifest.json is missing. candidates=${manifestCandidates.join(",")}`);
  }

  const rawManifest = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(rawManifest);
  const sidecarRoot = sidecarRootFromManifest(manifestPath);
  const serverEntryPath = path.join(sidecarRoot, manifest.serverEntry);
  const serverRootPath = path.join(sidecarRoot, manifest.serverRoot);
  const nodeBinaryPath = resolveNodeBinaryPath(sidecarRoot, manifest.nodeBinary, installedAppBundle);

  if (!existsSync(serverEntryPath)) {
    throw new Error(`Bundled server entry is missing: ${serverEntryPath}`);
  }
  if (!existsSync(serverRootPath)) {
    throw new Error(`Bundled server root is missing: ${serverRootPath}`);
  }

  const homeDir = path.join(tempRoot, "home");
  mkdirSync(homeDir, { recursive: true });
  const smokeInputFile = path.join(tempRoot, "smoke-input.log");
  writeFileSync(smokeInputFile, "");
  const smokePort = await reservePort();
  let logBuffer = "";
  let child = null;

  try {
    log(`Launching bundled server with node binary: ${nodeBinaryPath}`);
    child = spawn(nodeBinaryPath, [serverEntryPath], {
      cwd: serverRootPath,
      env: {
        ...process.env,
        HOME: homeDir,
        CLI_COMMENTATOR_PORT: String(smokePort),
        LLM_PROVIDER: "disabled",
        STYLE: "standard",
        INPUT_MODE: "file",
        INPUT_FILE: smokeInputFile,
        COMMENT_EXIT_TIMEOUT_MS: "1200",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      logBuffer += chunk.toString("utf8");
      if (logBuffer.length > 16000) {
        logBuffer = logBuffer.slice(-16000);
      }
    });
    child.stderr.on("data", (chunk) => {
      logBuffer += chunk.toString("utf8");
      if (logBuffer.length > 16000) {
        logBuffer = logBuffer.slice(-16000);
      }
    });

    await waitForHealth(smokePort, 20000);
    log(`Health check passed on port ${smokePort}`);

    const commentaryPromise = waitForCommentary(smokePort, 20000);
    await delay(400);
    appendFileSync(smokeInputFile, "gh pr checks --watch\n");
    const commentary = await commentaryPromise;
    log(`Received commentary event: ${commentary}`);
  } catch (error) {
    if (logBuffer.trim()) {
      log("Bundled server logs (tail):");
      process.stdout.write(`${logBuffer.trimEnd()}\n`);
    }
    throw error;
  } finally {
    await stopChild(child);
    rmSync(tempRoot, { recursive: true, force: true });
  }

  log("Desktop distribution runtime smoke passed.");
}

main().catch((error) => {
  console.error(`[desktop-smoke] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
