#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function usage() {
  console.error("Usage: pnpm dev:codex:file /absolute/path/to/target-repo");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

const targetRepo = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!targetRepo) {
  usage();
  process.exit(1);
}

const targetStat = await fs.stat(targetRepo).catch(() => null);
if (!targetStat?.isDirectory()) {
  console.error(`Target repo not found: ${targetRepo}`);
  process.exit(1);
}

const logDir = path.join(targetRepo, ".codex", "cli-commentator-log");
const logPath = path.join(logDir, "codex-tui.log");

await fs.mkdir(logDir, { recursive: true });
await fs.writeFile(logPath, "", "utf8");

console.log(`Watching Codex log: ${logPath}`);
console.log("Run Codex in the target repo from another terminal after the Web UI is up:");
console.log(`  codex --no-alt-screen -C ${shellQuote(targetRepo)} -c log_dir=${shellQuote(logDir)}`);

const child = spawn(
  "pnpm",
  ["dev"],
  {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      INPUT_MODE: "file",
      INPUT_FILE: logPath,
      LOG_SOURCE: "codex",
    },
    stdio: "inherit",
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`pnpm dev exited due to signal: ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
