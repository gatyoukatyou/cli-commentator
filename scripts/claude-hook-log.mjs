#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const [, , hookEventName, logPath] = process.argv;

function normalizeText(value, maxLength = 220) {
  if (typeof value !== "string") return "";
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}...`;
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const joined = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean).join(", ");
      if (joined) return joined;
    }
  }
  return "";
}

function toolTarget(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  return normalizeText(
    pickString(
      toolInput.file_path,
      toolInput.path,
      toolInput.paths,
      toolInput.pattern,
      toolInput.query,
      toolInput.url,
      toolInput.urls,
      toolInput.command,
      toolInput.description,
      toolInput.prompt
    )
  );
}

function formatPostToolUse(input) {
  const toolName = normalizeText(input.tool_name, 80);
  const toolInput = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const target = toolTarget(toolInput) || "detail";

  switch (toolName) {
    case "Read":
      return `⏺ Read(${target})`;
    case "Glob":
      return `⏺ Glob(${target})`;
    case "Grep":
      return `⏺ Grep(${target})`;
    case "Write":
      return `⏺ Write(${target})`;
    case "Edit":
    case "MultiEdit":
      return `⏺ Edit(${target})`;
    case "Bash":
      return `⏺ Bash(${target})`;
    case "Task":
      return `⏺ Task(${target})`;
    default:
      if (!toolName) return "";
      return `⏺ ${toolName}(${target})`;
  }
}

function formatHookLine(eventName, input) {
  switch (eventName) {
    case "SessionStart":
      return `⏺ SessionStart(${normalizeText(process.cwd(), 160) || "cwd"})`;
    case "UserPromptSubmit": {
      const prompt = normalizeText(pickString(input.prompt, input.message, input.user_prompt), 200);
      return prompt ? `⏺ Prompt(${prompt})` : "⏺ Prompt(submitted)";
    }
    case "PostToolUse":
      return formatPostToolUse(input);
    case "Stop": {
      const reason = normalizeText(
        pickString(input.stop_reason, input.reason, input.last_assistant_message, input.message),
        200
      );
      return reason ? `⏺ Stop(${reason})` : "⏺ Stop()";
    }
    case "SessionEnd": {
      const transcriptPath = normalizeText(pickString(input.transcript_path, input.cwd), 160);
      return transcriptPath ? `⏺ SessionEnd(${transcriptPath})` : "⏺ SessionEnd()";
    }
    default:
      return "";
  }
}

async function readHookInput() {
  if (process.stdin.isTTY) return {};

  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
  }

  if (!raw.trim()) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

if (!hookEventName || !logPath) {
  process.exit(0);
}

const input = await readHookInput();
const line = formatHookLine(hookEventName, input);

if (!line) {
  process.exit(0);
}

await fs.mkdir(path.dirname(logPath), { recursive: true });
await fs.appendFile(logPath, `${line}\n`, "utf8");

