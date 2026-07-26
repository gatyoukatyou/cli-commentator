import type { Event } from "./types.js";
import { rulesForLine } from "./rulesets/index.js";
import { isCodexProgressNoise } from "./progress-noise.js";
import { extractClaudeSupervisionEvents } from "./rulesets/claude-supervision.js";
import { isFileListExecution, isSearchExecution } from "./command-analysis.js";

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

type QuotedString = {
  value: string;
  end: number;
};

function readQuotedString(text: string, start: number): QuotedString | null {
  const quote = text[start];
  if (quote !== "\"" && quote !== "'" && quote !== "`") return null;

  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const ch = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    // Template interpolation would require evaluating JavaScript. Only static
    // template literals are accepted as command values.
    if (quote === "`" && ch === "$" && text[index + 1] === "{") return null;
    if (ch !== quote) continue;

    const raw = text.slice(start + 1, index);
    if (quote === "\"") {
      try {
        return { value: JSON.parse(text.slice(start, index + 1)), end: index + 1 };
      } catch {
        return null;
      }
    }

    // Decode only the escapes needed to identify ordinary shell commands.
    // Unknown escapes are preserved, avoiding eval or a full JavaScript parser.
    const value = raw.replace(/\\([\\'`nrt])/g, (_match, escapedChar: string) => {
      if (escapedChar === "n") return "\n";
      if (escapedChar === "r") return "\r";
      if (escapedChar === "t") return "\t";
      return escapedChar;
    });
    return { value, end: index + 1 };
  }
  return null;
}

function skipJsSpaceAndComments(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    if (/\s/.test(text[index])) {
      index += 1;
      continue;
    }
    if (text.startsWith("//", index)) {
      const newline = text.indexOf("\n", index + 2);
      return newline < 0 ? text.length : skipJsSpaceAndComments(text, newline + 1);
    }
    if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      return end < 0 ? text.length : skipJsSpaceAndComments(text, end + 2);
    }
    break;
  }
  return index;
}

function findJsToken(text: string, token: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === "\"" || ch === "'" || ch === "`") {
      let escaped = false;
      for (index += 1; index < text.length; index += 1) {
        if (escaped) {
          escaped = false;
        } else if (text[index] === "\\") {
          escaped = true;
        } else if (text[index] === ch) {
          break;
        }
      }
      continue;
    }
    if (text.startsWith("//", index) || text.startsWith("/*", index)) {
      const next = skipJsSpaceAndComments(text, index);
      if (next <= index || next >= text.length) return -1;
      index = next - 1;
      continue;
    }
    if (text.startsWith(token, index)) return index;
  }
  return -1;
}

function findMatchingDelimiter(text: string, start: number): number | null {
  const opener = text[start];
  const closer = opener === "(" ? ")" : opener === "{" ? "}" : opener === "[" ? "]" : null;
  if (!closer) return null;

  const stack = [closer];
  for (let index = start + 1; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === "\"" || ch === "'" || ch === "`") {
      const quoted = readQuotedString(text, index);
      if (!quoted) return null;
      index = quoted.end - 1;
      continue;
    }
    if (text.startsWith("//", index) || text.startsWith("/*", index)) {
      const next = skipJsSpaceAndComments(text, index);
      if (next <= index || next >= text.length) return null;
      index = next - 1;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      stack.push(ch === "(" ? ")" : ch === "{" ? "}" : "]");
      continue;
    }
    if (ch === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return index;
    }
  }
  return null;
}

function extractStaticCmdProperty(objectText: string): string | null {
  let index = 1;
  while (index < objectText.length - 1) {
    index = skipJsSpaceAndComments(objectText, index);
    if (index >= objectText.length - 1) break;

    let key: string | null = null;
    let keyEnd = index;
    if (objectText[index] === "\"" || objectText[index] === "'") {
      const quoted = readQuotedString(objectText, index);
      if (!quoted) return null;
      key = quoted.value;
      keyEnd = quoted.end;
    } else {
      const identifier = objectText.slice(index).match(/^[A-Za-z_$][A-Za-z0-9_$]*/)?.[0];
      if (identifier) {
        key = identifier;
        keyEnd = index + identifier.length;
      }
    }

    if (key !== null) {
      const colon = skipJsSpaceAndComments(objectText, keyEnd);
      if (objectText[colon] === ":") {
        const valueStart = skipJsSpaceAndComments(objectText, colon + 1);
        if (key === "cmd") {
          return readQuotedString(objectText, valueStart)?.value ?? null;
        }
      }
    }

    const ch = objectText[index];
    if (ch === "\"" || ch === "'" || ch === "`") {
      const quoted = readQuotedString(objectText, index);
      if (!quoted) return null;
      index = quoted.end;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      const end = findMatchingDelimiter(objectText, index);
      if (end === null) return null;
      index = end + 1;
      continue;
    }
    index += 1;
  }
  return null;
}

function extractCurrentExecCommands(payload: string): string[] {
  const marker = "tools.exec_command";
  const commands: string[] = [];
  let index = 0;

  while (index < payload.length) {
    const found = findJsToken(payload, marker, index);
    if (found < 0) break;

    const before = payload[found - 1];
    const after = payload[found + marker.length];
    if ((before && /[A-Za-z0-9_$]/.test(before)) || (after && /[A-Za-z0-9_$]/.test(after))) {
      index = found + marker.length;
      continue;
    }

    const openParen = skipJsSpaceAndComments(payload, found + marker.length);
    if (payload[openParen] !== "(") {
      index = found + marker.length;
      continue;
    }
    const closeParen = findMatchingDelimiter(payload, openParen);
    if (closeParen === null) break;

    const objectStart = skipJsSpaceAndComments(payload, openParen + 1);
    if (payload[objectStart] === "{") {
      const objectEnd = findMatchingDelimiter(payload, objectStart);
      if (objectEnd !== null && objectEnd < closeParen) {
        const cmd = extractStaticCmdProperty(payload.slice(objectStart, objectEnd + 1));
        if (cmd) commands.push(cmd);
      }
    }
    index = closeParen + 1;
  }

  return commands;
}

function safeCommandPreview(cmd: string): string {
  const compact = cmd.replace(/\s+/g, " ").trim();
  const redacted = compact
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Za-z0-9_]*)=([^\s]+)/gi, "$1=[REDACTED]")
    .replace(/(--?(?:token|secret|password|api[-_]?key))(?:=|\s+)('[^']*'|\"[^\"]*\"|[^\s]+)/gi, "$1=[REDACTED]");
  return redacted.length <= 240 ? redacted : `${redacted.slice(0, 237)}...`;
}

function classifyExecCommands(commands: string[]): string | null {
  if (commands.length === 0) return null;
  const visible = commands.slice(0, 2).map(safeCommandPreview);
  const omitted = commands.length - visible.length;
  const combined = visible.join(" ; ") + (omitted > 0 ? ` ... (+${omitted} commands)` : "");
  return classifyExecCommand(combined);
}

function classifyExecCommand(cmd: string): string {
  const compact = cmd.trim();
  if (!compact) return "⏺ Bash(exec_command)";

  if (isFileListExecution(compact)) {
    return `⏺ Glob(${compact})`;
  }

  if (isSearchExecution(compact)) {
    return `⏺ Grep(${compact})`;
  }

  if (/^\s*(cat|sed|head|tail|less|more|nl)\b/i.test(compact)) {
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
    case "exec":
      return classifyExecCommands(extractCurrentExecCommands(payload)) ?? "";
    case "exec_command": {
      const parsed = parseToolPayload(payload);
      const cmd = typeof parsed?.cmd === "string" ? parsed.cmd : "";
      return classifyExecCommands(cmd ? [cmd] : []) ?? "";
    }
    case "apply_patch":
      return "apply_patch";
    case "wait":
    case "write_stdin":
      return "";
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

function isRoutineCodexInternalLog(line: string): boolean {
  if (!/\bcodex_core_[A-Za-z0-9_]+::/i.test(line)) return false;
  if (/(?:^|\s)ERROR(?:\s|$)/.test(line)) return false;
  if (/\bfailed_[A-Za-z0-9_]*=\[\]/i.test(line)) return true;
  return /(?:^|\s)(TRACE|DEBUG|INFO)(?:\s|$)/.test(line);
}

function hasOnlyEmptyFailureMarkers(line: string): boolean {
  const withoutEmptyMarkers = line.replace(/\bfailed_[A-Za-z0-9_]*=\[\]/gi, "");
  return (
    withoutEmptyMarkers !== line &&
    !/\b(?:execution error|error|failed|exception|panic|ELIFECYCLE|exit code)\b/i.test(withoutEmptyMarkers)
  );
}

function preprocessLine(rawLine: string, sourceEnv?: string): string | null {
  const normalized = normalizeLine(rawLine);
  if (!normalized) return null;

  const source = (sourceEnv ?? "").trim().toLowerCase();
  if (source === "codex" && isCodexProgressNoise(normalized)) {
    return null;
  }

  if (/would you like to run the following command\?/i.test(normalized)) {
    return "Would you like to run the following command?";
  }

  if (/^Question \d+\/\d+ \(0+ unanswered\)$/i.test(normalized)) {
    return null;
  }

  if (/^Question \d+\/\d+ \((?:[1-9]\d*) unanswered\)$/i.test(normalized)) {
    return normalized;
  }

  const approvedMatch = normalized.match(/you approved .* to run:\s*(.+)$/i);
  if (approvedMatch) {
    return `You approved codex to run: ${approvedMatch[1].trim()}`;
  }

  const codexToolCall = canonicalizeCodexToolCall(normalized);
  if (codexToolCall !== null) {
    return codexToolCall || null;
  }

  if (isRoutineCodexInternalLog(normalized) || hasOnlyEmptyFailureMarkers(normalized)) {
    return null;
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

  if (source === "codex" || /\bcodex_core::/i.test(normalized)) {
    return null;
  }

  return normalized;
}

export function extractEvents(chunk: string, sourceEnv: string | undefined = process.env.LOG_SOURCE): Event[] {
  const ts = Date.now();

  if ((sourceEnv ?? "").trim().toLowerCase() === "claude") {
    const supervisionEvents = extractClaudeSupervisionEvents(chunk, ts);
    if (supervisionEvents.length > 0) return supervisionEvents;
  }

  const rawLines = chunk.split(/\r?\n/);
  const events: Event[] = [];
  for (let index = 0; index < rawLines.length; index += 1) {
    const rawLine = rawLines[index];
    const sourceLine = normalizeLine(rawLine);
    if (!sourceLine) continue;

    const line = preprocessLine(rawLine, sourceEnv);
    if (!line) continue;

    const rules = rulesForLine(sourceLine, sourceEnv);
    const hit = rules.find((rule) => rule.match ? rule.match(line) : rule.re.test(line));
    if (hit) {
      let detail = line;
      if (hit.id === "codex.approval.ask") {
        for (
          let commandIndex = index + 1;
          commandIndex < Math.min(rawLines.length, index + 6);
          commandIndex += 1
        ) {
          const command = normalizeLine(rawLines[commandIndex])
            .replace(/^(?:[$›❯>]\s*)+/u, "")
            .trim();
          if (
            /^(?:(?:sudo|command|env)\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:pnpm|npm|yarn|bun|npx|node|git|gh|cargo|docker|make|go|python\d*|deno|rm|mv|cp|mkdir|chmod|curl)\b/iu.test(command)
          ) {
            detail = `${line}\n${command}`;
            index = commandIndex;
            break;
          }
        }
      }
      events.push({ ts, type: hit.type, summary: hit.summary, detail });
    } else events.push({ ts, type: "stdout", summary: "ログ更新", detail: line });
  }
  return events;
}
