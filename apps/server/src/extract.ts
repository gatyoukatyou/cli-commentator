import type { Event } from "./types.js";
import { rulesForLine } from "./rulesets/index.js";

// Remove ANSI/VT control sequences so TUI apps like Claude Code still match rules.
const ANSI_ESCAPE_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters by definition.
  /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;

function normalizeLine(line: string): string {
  return line.replace(ANSI_ESCAPE_RE, "").trim();
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const ch = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function parseToolPayload(text: string): Record<string, unknown> | null {
  const jsonText = extractJsonObject(text);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function classifyExecCommand(cmd: string): string {
  const compact = cmd.trim();
  if (!compact) return "⏺ Bash(exec_command)";

  if (/\b(rg\s+--files|find|fd)\b/i.test(compact)) {
    return `⏺ Glob(${compact})`;
  }

  if (/\b(rg|grep)\b/i.test(compact)) {
    return `⏺ Grep(${compact})`;
  }

  if (/^\s*(cat|sed|head|tail|less|more)\b/i.test(compact)) {
    return `⏺ Read(${compact})`;
  }

  return `⏺ Bash(${compact})`;
}

function canonicalizeCodexToolCall(rawLine: string): string | null {
  const toolMatch = rawLine.match(/\bToolCall:\s+([A-Za-z0-9_.:]+)\b(?:\s+(.*))?$/);
  if (!toolMatch) return null;

  const fullToolName = toolMatch[1];
  const toolName = fullToolName.split(".").at(-1) ?? fullToolName;
  const payload = toolMatch[2] ?? "";

  switch (toolName) {
    case "exec_command": {
      const parsed = parseToolPayload(payload);
      const cmd = typeof parsed?.cmd === "string" ? parsed.cmd : "";
      return classifyExecCommand(cmd);
    }
    case "apply_patch":
      return "apply_patch";
    case "write_stdin":
      return null;
    case "list_mcp_resources":
    case "list_mcp_resource_templates":
    case "search_query":
    case "image_query":
    case "find":
      return `ToolCall: ${toolName}`;
    case "read_mcp_resource":
    case "open":
    case "click":
    case "view_image":
      return `⏺ Read(${toolName})`;
    default:
      return `ToolCall: ${fullToolName}`;
  }
}

function preprocessLine(rawLine: string, sourceEnv?: string): string | null {
  const normalized = normalizeLine(rawLine);
  if (!normalized) return null;

  if (/would you like to run the following command\?/i.test(normalized)) {
    return "Would you like to run the following command?";
  }

  const approvedMatch = normalized.match(/you approved .* to run:\s*(.+)$/i);
  if (approvedMatch) {
    return `You approved codex to run: ${approvedMatch[1].trim()}`;
  }

  const codexToolCall = canonicalizeCodexToolCall(normalized);
  if (codexToolCall !== null) {
    return codexToolCall;
  }

  if (/\bcodex_core::/i.test(normalized)) {
    return null;
  }

  if (/^(⏺|•)\s*(Read|Glob|Grep|Update|Write|Bash)\(/.test(normalized)) {
    return normalized;
  }

  if (/^>\s/.test(normalized) || /\bapply_patch\b|ELIFECYCLE|exit code|error|failed|exception|TS\d{4,5}/i.test(normalized)) {
    return normalized;
  }

  const source = (sourceEnv ?? "").trim().toLowerCase();
  if (source === "codex" || /\bcodex_core::/i.test(normalized)) {
    return null;
  }

  return normalized;
}

export function extractEvents(chunk: string): Event[] {
  const ts = Date.now();

  const events: Event[] = [];
  for (const rawLine of chunk.split(/\r?\n/)) {
    const sourceLine = normalizeLine(rawLine);
    if (!sourceLine) continue;

    const line = preprocessLine(rawLine, process.env.LOG_SOURCE);
    if (!line) continue;

    const rules = rulesForLine(sourceLine, process.env.LOG_SOURCE);
    const hit = rules.find((rule) => rule.re.test(line));
    if (hit) events.push({ ts, type: hit.type, summary: hit.summary, detail: line });
    else events.push({ ts, type: "stdout", summary: "ログ更新", detail: line });
  }
  return events;
}
