#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGGER_PATH = path.resolve(__dirname, "claude-hook-log.mjs");
const LOGGER_MARKER = path.basename(LOGGER_PATH);

function usage() {
  console.error("Usage: pnpm claude:setup-hooks /absolute/path/to/target-repo");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function loggerCommand(eventName, logPath) {
  return `${shellQuote(process.execPath)} ${shellQuote(LOGGER_PATH)} ${shellQuote(eventName)} ${shellQuote(logPath)}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pruneExistingLoggerEntries(entries) {
  if (!Array.isArray(entries)) return [];

  return entries.flatMap((entry) => {
    if (!isRecord(entry)) return [entry];
    if (!Array.isArray(entry.hooks)) return [entry];

    const hooks = entry.hooks.filter((hook) => {
      if (!isRecord(hook)) return true;
      return !(hook.type === "command" && typeof hook.command === "string" && hook.command.includes(LOGGER_MARKER));
    });

    if (hooks.length === 0) {
      return [];
    }

    return [{ ...entry, hooks }];
  });
}

async function loadSettings(settingsPath) {
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      throw new Error("settings.local.json must contain a JSON object");
    }
    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
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

const claudeDir = path.join(targetRepo, ".claude");
const settingsPath = path.join(claudeDir, "settings.local.json");
const logPath = path.join(claudeDir, "cli-commentator.claude.log");

await fs.mkdir(claudeDir, { recursive: true });
await fs.writeFile(logPath, "", { flag: "a" });

const settings = await loadSettings(settingsPath);
const hooks = isRecord(settings.hooks) ? settings.hooks : {};

const nextHooks = {
  ...hooks,
  SessionStart: [
    ...pruneExistingLoggerEntries(hooks.SessionStart),
    {
      hooks: [{ type: "command", command: loggerCommand("SessionStart", logPath) }],
    },
  ],
  UserPromptSubmit: [
    ...pruneExistingLoggerEntries(hooks.UserPromptSubmit),
    {
      hooks: [{ type: "command", command: loggerCommand("UserPromptSubmit", logPath) }],
    },
  ],
  PostToolUse: [
    ...pruneExistingLoggerEntries(hooks.PostToolUse),
    {
      matcher: "Read|Write|Edit|MultiEdit|Bash|Glob|Grep|Task|WebFetch|WebSearch",
      hooks: [{ type: "command", command: loggerCommand("PostToolUse", logPath) }],
    },
  ],
  Stop: [
    ...pruneExistingLoggerEntries(hooks.Stop),
    {
      hooks: [{ type: "command", command: loggerCommand("Stop", logPath) }],
    },
  ],
  SessionEnd: [
    ...pruneExistingLoggerEntries(hooks.SessionEnd),
    {
      hooks: [{ type: "command", command: loggerCommand("SessionEnd", logPath) }],
    },
  ],
};

const nextSettings = {
  ...settings,
  hooks: nextHooks,
};

await fs.writeFile(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, "utf8");

console.log(`Updated Claude hooks: ${settingsPath}`);
console.log(`Commentary log file: ${logPath}`);
console.log("Next:");
console.log(`  pnpm dev:claude:file ${shellQuote(targetRepo)}`);
console.log(`  cd ${shellQuote(targetRepo)} && claude`);

