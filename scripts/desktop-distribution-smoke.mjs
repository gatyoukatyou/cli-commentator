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

function formatFailure(category, summary, contextEntries) {
  let message = `[${category}] ${summary}`;
  for (const [key, value] of contextEntries) {
    if (!value) continue;
    message += ` | ${key}=${value}`;
  }
  return message;
}

function resolveManifestPath(resourcesDir) {
  const manifestCandidates = [
    path.join(resourcesDir, "resources", "sidecar-manifest.json"),
    path.join(resourcesDir, "sidecar-manifest.json"),
  ];
  const manifestPath = manifestCandidates.find((candidate) => existsSync(candidate));
  if (!manifestPath) {
    throw new Error(
      formatFailure("sidecar_manifest_missing", "No sidecar manifest was found", [
        ["candidates", manifestCandidates.join(",")],
      ])
    );
  }
  return manifestPath;
}

function resolveNodeBinaryPath(sidecarRoot, manifestNodeBinary, appBundlePath, manifestPath) {
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
    const expected = path.join(sidecarRoot, manifestNodeBinary);
    throw new Error(
      formatFailure("sidecar_node_missing", "Bundled node binary is missing", [
        ["manifest", manifestPath],
        ["sidecar_root", sidecarRoot],
        ["node_binary", expected],
        ["candidates", candidates.join(",")],
        ["executable_dir", macOsDir],
      ])
    );
  }
  return existing;
}

function resolveBundledRuntimePaths(appBundlePath) {
  const resourcesDir = path.join(appBundlePath, "Contents", "Resources");
  const manifestPath = resolveManifestPath(resourcesDir);

  let rawManifest;
  try {
    rawManifest = readFileSync(manifestPath, "utf8");
  } catch (error) {
    throw new Error(
      formatFailure("sidecar_manifest_read", "Failed to read sidecar manifest", [
        ["manifest", manifestPath],
        ["error", error instanceof Error ? error.message : String(error)],
      ])
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(rawManifest);
  } catch (error) {
    throw new Error(
      formatFailure("sidecar_manifest_parse", "Failed to parse sidecar manifest", [
        ["manifest", manifestPath],
        ["error", error instanceof Error ? error.message : String(error)],
      ])
    );
  }

  const sidecarRoot = sidecarRootFromManifest(manifestPath);
  const serverEntryPath = path.join(sidecarRoot, manifest.serverEntry);
  const serverRootPath = path.join(sidecarRoot, manifest.serverRoot);
  const nodeBinaryPath = resolveNodeBinaryPath(
    sidecarRoot,
    manifest.nodeBinary,
    appBundlePath,
    manifestPath
  );

  if (!existsSync(serverEntryPath)) {
    throw new Error(
      formatFailure("sidecar_server_entry_missing", "Bundled server entry is missing", [
        ["manifest", manifestPath],
        ["sidecar_root", sidecarRoot],
        ["server_entry", serverEntryPath],
      ])
    );
  }
  if (!existsSync(serverRootPath)) {
    throw new Error(
      formatFailure("sidecar_server_root_missing", "Bundled server root is missing", [
        ["manifest", manifestPath],
        ["sidecar_root", sidecarRoot],
        ["server_root", serverRootPath],
      ])
    );
  }

  return {
    manifestPath,
    sidecarRoot,
    nodeBinaryPath,
    serverEntryPath,
    serverRootPath,
  };
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

async function waitForCommentOk(readLog, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (/\bcomment_ok\b/.test(readLog())) {
      return;
    }
    await delay(200);
  }
  throw new Error("Timed out waiting for `comment_ok` log from bundled server");
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

function installAppBundle(sourceAppBundle, tempRoot, installDirName) {
  const installRoot = path.join(tempRoot, installDirName);
  mkdirSync(installRoot, { recursive: true });
  const installedAppBundle = path.join(installRoot, path.basename(sourceAppBundle));
  cpSync(sourceAppBundle, installedAppBundle, { recursive: true });
  return installedAppBundle;
}

async function runHealthyBundleScenario(appBundlePath, tempRoot) {
  const { nodeBinaryPath, serverEntryPath, serverRootPath } = resolveBundledRuntimePaths(appBundlePath);
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
        LLM_PROVIDER: "mock",
        DEBUG: "1",
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

    await delay(400);
    appendFileSync(smokeInputFile, "gh pr checks --watch\n");
    await waitForCommentOk(() => logBuffer, 20000);
    log("Detected commentary generation (`comment_ok`) from bundled server.");
  } catch (error) {
    if (logBuffer.trim()) {
      log("Bundled server logs (tail):");
      process.stdout.write(`${logBuffer.trimEnd()}\n`);
    }
    throw error;
  } finally {
    await stopChild(child);
  }
}

function runMissingServerEntryScenario(appBundlePath) {
  const { serverEntryPath } = resolveBundledRuntimePaths(appBundlePath);
  rmSync(serverEntryPath, { force: true });

  try {
    resolveBundledRuntimePaths(appBundlePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("[sidecar_server_entry_missing]")) {
      throw error;
    }
    if (!message.includes(`server_entry=${serverEntryPath}`)) {
      throw new Error(`Missing server_entry diagnostic in failure: ${message}`);
    }
    log(`Verified failure path: ${message}`);
    return;
  }

  throw new Error("Expected sidecar_server_entry_missing failure after removing bundled server entry");
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
  try {
    const healthyAppBundle = installAppBundle(sourceAppBundle, tempRoot, "Applications-success");
    log(`Installed app bundle into temp root: ${healthyAppBundle}`);
    await runHealthyBundleScenario(healthyAppBundle, path.join(tempRoot, "success-scenario"));

    const missingEntryAppBundle = installAppBundle(sourceAppBundle, tempRoot, "Applications-missing-entry");
    log(`Installed failure-path app bundle into temp root: ${missingEntryAppBundle}`);
    runMissingServerEntryScenario(missingEntryAppBundle);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  log("Desktop distribution runtime smoke passed.");
}

main().catch((error) => {
  console.error(`[desktop-smoke] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
