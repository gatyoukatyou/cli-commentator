#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeDesktopSidecarFingerprint,
  SIDECAR_FINGERPRINT_VERSION,
} from "./desktop-sidecar-fingerprint.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const srcTauriDir = path.join(repoRoot, "apps", "desktop", "src-tauri");
const manifestPath = path.join(srcTauriDir, "resources", "sidecar-manifest.json");

function fail(message) {
  console.error(`[ensure-sidecar] ${message}`);
  process.exit(1);
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return { __parseError: String(error) };
  }
}

function check() {
  const manifest = readManifest();
  if (!manifest) {
    return { ok: false, reason: "missing manifest" };
  }
  if (manifest.__parseError) {
    return {
      ok: false,
      reason: `manifest parse error: ${manifest.__parseError}`,
    };
  }

  for (const key of ["nodeBinary", "serverEntry"]) {
    if (
      !manifest[key] ||
      typeof manifest[key] !== "string" ||
      !manifest[key].trim()
    ) {
      return { ok: false, reason: `missing/invalid field: ${key}` };
    }
  }

  const nodePath = path.join(srcTauriDir, manifest.nodeBinary);
  const entryPath = path.join(srcTauriDir, manifest.serverEntry);

  if (!fs.existsSync(nodePath)) {
    return { ok: false, reason: `nodeBinary not found: ${manifest.nodeBinary}` };
  }
  if (!fs.existsSync(entryPath)) {
    return { ok: false, reason: `serverEntry not found: ${manifest.serverEntry}` };
  }

  if (manifest.inputFingerprintVersion !== SIDECAR_FINGERPRINT_VERSION) {
    return {
      ok: false,
      reason: "missing/outdated sidecar input fingerprint",
    };
  }

  const currentFingerprint = computeDesktopSidecarFingerprint(repoRoot);
  if (manifest.inputFingerprint !== currentFingerprint) {
    return {
      ok: false,
      reason: "sidecar inputs changed",
    };
  }

  return { ok: true, reason: "ok" };
}

let result = check();
if (!result.ok) {
  console.log(`[ensure-sidecar] not ready: ${result.reason}`);
  console.log("[ensure-sidecar] running: pnpm prepare:desktop-sidecar");

  const run = spawnSync("pnpm", ["prepare:desktop-sidecar"], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (run.status !== 0) {
    fail(`prepare:desktop-sidecar failed (exit ${run.status})`);
  }

  result = check();
  if (!result.ok) {
    fail(`still not ready after prepare: ${result.reason}`);
  }
}

console.log("[ensure-sidecar] ok");
