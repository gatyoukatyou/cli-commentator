#!/usr/bin/env node

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const REQUIREMENTS = {
  app: {
    label: ".app bundle",
    match: (filePath, stats) => stats.isDirectory() && filePath.endsWith(".app"),
  },
  dmg: {
    label: ".dmg installer",
    match: (filePath, stats) => stats.isFile() && filePath.endsWith(".dmg"),
  },
  "app-tar-gz": {
    label: ".app.tar.gz updater archive",
    match: (filePath, stats) => stats.isFile() && filePath.endsWith(".app.tar.gz"),
  },
  sig: {
    label: ".sig updater signature",
    match: (filePath, stats) => stats.isFile() && filePath.endsWith(".sig"),
  },
};

function fail(message) {
  console.error(`[desktop-artifacts] ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    bundleDir: null,
    requirements: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--require") {
      const next = argv[index + 1];
      if (!next) fail("--require needs one of: app, dmg, app-tar-gz, sig");
      if (!REQUIREMENTS[next]) fail(`Unknown artifact requirement: ${next}`);
      args.requirements.push(next);
      index += 1;
      continue;
    }
    if (value === "--help" || value === "-h") {
      console.log(
        [
          "Usage: node scripts/verify-desktop-bundle-artifacts.mjs <bundle-dir> [--require <kind>...]",
          "",
          "Kinds: app, dmg, app-tar-gz, sig",
        ].join("\n")
      );
      process.exit(0);
    }
    if (!args.bundleDir) {
      args.bundleDir = value;
      continue;
    }
    fail(`Unexpected argument: ${value}`);
  }

  if (!args.bundleDir) fail("Bundle directory is required");
  if (args.requirements.length === 0) args.requirements.push("app");
  return args;
}

function walk(rootDir) {
  const found = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !existsSync(current)) continue;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const stats = statSync(fullPath);
      found.push({ path: fullPath, stats });
      if (entry.isDirectory() && !entry.name.endsWith(".app")) {
        stack.push(fullPath);
      }
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

function directorySize(rootDir) {
  let total = 0;
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const stats = statSync(current);
    if (stats.isFile()) {
      total += stats.size;
      continue;
    }
    if (!stats.isDirectory()) continue;
    for (const entry of readdirSync(current)) {
      stack.push(path.join(current, entry));
    }
  }
  return total;
}

function artifactSize(entry) {
  return entry.stats.isDirectory() ? directorySize(entry.path) : entry.stats.size;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundleDir = path.resolve(args.bundleDir);
  if (!existsSync(bundleDir)) fail(`Bundle directory does not exist: ${bundleDir}`);

  const entries = walk(bundleDir);
  for (const requirement of args.requirements) {
    const rule = REQUIREMENTS[requirement];
    const matches = entries.filter((entry) => rule.match(entry.path, entry.stats));
    if (matches.length === 0) fail(`Missing required artifact: ${rule.label}`);

    for (const match of matches) {
      const size = artifactSize(match);
      if (size <= 0) fail(`Artifact is empty: ${match.path}`);
      console.log(`[desktop-artifacts] ${rule.label}: ${path.relative(process.cwd(), match.path)} (${size} bytes)`);
    }
  }

  console.log("[desktop-artifacts] Desktop bundle artifact checks passed.");
}

main();
