#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const workspaceFile = path.join(repoRoot, "pnpm-workspace.yaml");
const serverDir = path.join(repoRoot, "apps", "server");
const serverDistDir = path.join(serverDir, "dist");
const tauriDir = path.join(repoRoot, "apps", "desktop", "src-tauri");
const resourcesDir = path.join(tauriDir, "resources");
const bundledServerDir = path.join(resourcesDir, "server");
const platformDirName = `${process.platform}-${process.arch}`;
const bundledNodeDir = path.join(tauriDir, "bin", platformDirName);
const nodeBinaryName = process.platform === "win32" ? "node.exe" : "node";
const bundledNodePath = path.join(bundledNodeDir, nodeBinaryName);
const stageDir = mkdtempSync(path.join(os.tmpdir(), "cli-commentator-sidecar-"));
const tempStoreDir = mkdtempSync(path.join(os.tmpdir(), "cli-commentator-pnpm-store-"));

function run(cmd, args, cwd = repoRoot) {
  const result = spawnSync(cmd, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
  }
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function readPackageVersion(packageJsonPath) {
  const raw = readFileSync(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw);
  return String(parsed.version ?? "0.0.0");
}

if (!existsSync(workspaceFile)) {
  throw new Error("pnpm-workspace.yaml not found. Run this script from the repository.");
}

try {
  console.log("[sidecar] Building server dist...");
  run("pnpm", ["-C", "apps/server", "build"]);

  if (!existsSync(serverDistDir)) {
    throw new Error("Server build output missing: apps/server/dist");
  }

  console.log("[sidecar] Deploying production server dependencies...");
  run("pnpm", [
    "--store-dir",
    tempStoreDir,
    "--node-linker",
    "hoisted",
    "--filter",
    "@cli-commentator/server",
    "--prod",
    "deploy",
    stageDir,
  ]);

  console.log("[sidecar] Copying deployed server bundle...");
  rmSync(bundledServerDir, { recursive: true, force: true });
  mkdirSync(resourcesDir, { recursive: true });
  cpSync(stageDir, bundledServerDir, { recursive: true });

  // Always overwrite dist from local build so the entrypoint is deterministic.
  cpSync(serverDistDir, path.join(bundledServerDir, "dist"), { recursive: true, force: true });

  // Keep sidecar payload small and focused on runtime artifacts.
  rmSync(path.join(bundledServerDir, "src"), { recursive: true, force: true });
  rmSync(path.join(bundledServerDir, "test"), { recursive: true, force: true });
  rmSync(path.join(bundledServerDir, "tsconfig.json"), { recursive: true, force: true });
  rmSync(path.join(bundledServerDir, "tsconfig.build.json"), { recursive: true, force: true });
  rmSync(path.join(bundledServerDir, ".env"), { recursive: true, force: true });
  rmSync(path.join(bundledServerDir, ".env.local"), { recursive: true, force: true });
  rmSync(path.join(bundledServerDir, ".env.development"), { recursive: true, force: true });
  rmSync(path.join(bundledServerDir, ".env.production"), { recursive: true, force: true });

  console.log("[sidecar] Copying node runtime...");
  const nodeSource = realpathSync(process.execPath);
  mkdirSync(bundledNodeDir, { recursive: true });
  copyFileSync(nodeSource, bundledNodePath);
  if (process.platform !== "win32") {
    chmodSync(bundledNodePath, 0o755);
  }

  const manifestPath = path.join(resourcesDir, "sidecar-manifest.json");
  const manifest = {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    serverVersion: readPackageVersion(path.join(serverDir, "package.json")),
    nodeBinary: toPosix(path.relative(tauriDir, bundledNodePath)),
    serverRoot: toPosix(path.relative(tauriDir, bundledServerDir)),
    serverEntry: toPosix(path.join(path.relative(tauriDir, bundledServerDir), "dist", "index.js")),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log("[sidecar] Done.");
  console.log(`- node: ${manifest.nodeBinary}`);
  console.log(`- server root: ${manifest.serverRoot}`);
  console.log(`- server entry: ${manifest.serverEntry}`);
  console.log(`- manifest: ${toPosix(path.relative(repoRoot, manifestPath))}`);
} finally {
  rmSync(stageDir, { recursive: true, force: true });
  rmSync(tempStoreDir, { recursive: true, force: true });
}
