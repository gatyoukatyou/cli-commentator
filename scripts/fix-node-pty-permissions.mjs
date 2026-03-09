#!/usr/bin/env node

import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const pnpmStoreDir = path.join(repoRoot, "node_modules", ".pnpm");

function isExecutable(mode) {
  return (mode & 0o111) !== 0;
}

function findSpawnHelpers(baseDir) {
  if (!existsSync(baseDir)) {
    return [];
  }

  const helpers = [];
  for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("node-pty@")) {
      continue;
    }

    const prebuildsDir = path.join(baseDir, entry.name, "node_modules", "node-pty", "prebuilds");
    if (!existsSync(prebuildsDir)) {
      continue;
    }

    for (const platformEntry of readdirSync(prebuildsDir, { withFileTypes: true })) {
      if (!platformEntry.isDirectory()) {
        continue;
      }
      const helperPath = path.join(prebuildsDir, platformEntry.name, "spawn-helper");
      if (existsSync(helperPath)) {
        helpers.push(helperPath);
      }
    }
  }

  return helpers;
}

function main() {
  if (process.platform === "win32") {
    console.log("[postinstall] Skipping node-pty spawn-helper permission fix on Windows.");
    return;
  }

  const helperPaths = findSpawnHelpers(pnpmStoreDir);

  if (helperPaths.length === 0) {
    console.log("[postinstall] No node-pty spawn-helper binaries found.");
    return;
  }

  let updatedCount = 0;
  for (const helperPath of helperPaths) {
    const currentMode = statSync(helperPath).mode;
    if (isExecutable(currentMode)) {
      continue;
    }
    chmodSync(helperPath, 0o755);
    updatedCount += 1;
  }

  if (updatedCount === 0) {
    console.log(`[postinstall] node-pty spawn-helper permissions already OK (${helperPaths.length} checked).`);
    return;
  }

  console.log(`[postinstall] Restored executable permissions on ${updatedCount} node-pty spawn-helper file(s).`);
}

main();
