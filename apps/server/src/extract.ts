import type { Event } from "./types.js";
import { getAutoDetectedSource, rulesForLine } from "./rulesets/index.js";
import { isClaudeTuiNoise, isCodexProgressNoise, isCodexTuiAssistantLine, isTerminalRenderingNoise } from "./progress-noise.js";
import { extractClaudeSupervisionEvents } from "./rulesets/claude-supervision.js";
import { extractFileListCommand, isFileListExecution, isSearchExecution } from "./command-analysis.js";
import { ANSI_ESCAPE_RE } from "./terminal-escapes.js";

// Legacy X10 mouse reports include three coordinate bytes after CSI M. Strip
// them before the generic CSI matcher consumes only the introducer.
const LEGACY_MOUSE_REPORT_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal mouse reports contain ESC.
  /\u001B\[M[\u0020-\u00ff]{3}/g;

// Character-set designation sequences such as ESC ( B otherwise leave "(B"
// behind after ordinary ANSI stripping.
const CHARSET_DESIGNATION_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters by definition.
  /\u001B[()*+][0-2A-Z]/g;

function normalizeLine(line: string): string {
  return line
    .replace(LEGACY_MOUSE_REPORT_RE, "")
    .replace(CHARSET_DESIGNATION_RE, "")
    .replace(ANSI_ESCAPE_RE, "")
    .replace(/\t/g, " ")
    // Tab (0x09) was normalized above; remove the remaining C0 controls, including LF.
    .replace(/[\u0000-\u0008\u000a-\u001f\u007f]/g, "")
    .trim();
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
  if (redacted.length <= 240) return redacted;
  return `${redacted.slice(0, 237)}...`;
}

function classifyExecCommands(commands: string[]): string | null {
  if (commands.length === 0) return null;
  const visible = commands.slice(0, 2).map((command) => safeCommandPreview(command));
  const omitted = commands.length - visible.length;
  const combined = visible.join(" ; ") + (omitted > 0 ? ` ... (+${omitted} commands)` : "");
  return classifyExecCommand(combined);
}

function classifyExecCommand(cmd: string, displayCmd = cmd): string {
  const compact = cmd.trim();
  if (!compact) return "⏺ Bash(exec_command)";
  const display = displayCmd.trim();

  if (isFileListExecution(compact)) {
    return `⏺ Glob(${display})`;
  }

  if (isSearchExecution(compact)) {
    return `⏺ Grep(${display})`;
  }

  if (/^\s*(cat|sed|head|tail|less|more|nl)\b/i.test(compact)) {
    return `⏺ Read(${display})`;
  }

  return `⏺ Bash(${display})`;
}

const CODEX_TUI_BUFFER_LIMIT = 8_192;
let codexTuiBuffer = "";
let lastCodexTuiCommand = "";
let lastCodexTuiAssistant = "";
let lastCodexTuiAnswer = "";

export function resetExtractionState(): void {
  codexTuiBuffer = "";
  lastCodexTuiCommand = "";
  lastCodexTuiAssistant = "";
  lastCodexTuiAnswer = "";
}

function normalizeTuiStream(chunk: string): string {
  return chunk
    .replace(LEGACY_MOUSE_REPORT_RE, "")
    .replace(CHARSET_DESIGNATION_RE, "")
    .replace(ANSI_ESCAPE_RE, "")
    .replace(/\r/g, "")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "");
}

function eventForCanonicalLine(line: string, ts: number): Event | null {
  const hit = rulesForLine(line, "codex")
    .find((rule) => rule.match ? rule.match(line) : rule.re.test(line));
  return hit ? { ts, type: hit.type, summary: hit.summary, detail: line } : null;
}

function extractCodexTuiEvents(chunk: string, ts: number): Event[] {
  // PTY chunks can split a terminal line at any byte. Inserting a newline at
  // every chunk boundary corrupts the reconstructed TUI and makes extraction
  // depend on node-pty's timing.
  codexTuiBuffer = `${codexTuiBuffer}${normalizeTuiStream(chunk)}`
    .slice(-CODEX_TUI_BUFFER_LIMIT);

  const events: Event[] = [];
  const commandCard = /(?:^|\n)\s*•\s+Ran\s+([\s\S]*?)\n\s*└\s*/gu;
  let consumedThrough = 0;

  for (const match of codexTuiBuffer.matchAll(commandCard)) {
    consumedThrough = (match.index ?? 0) + match[0].length;
    const command = match[1]
      .split("\n")
      .map((line) => line.replace(/^\s*│\s?/u, "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim();
    if (!command || command === lastCodexTuiCommand) continue;

    const displayCommand = extractFileListCommand(command) ?? command;
    const canonical = classifyExecCommand(command, safeCommandPreview(displayCommand));
    const event = eventForCanonicalLine(canonical, ts);
    if (event) events.push(event);
    lastCodexTuiCommand = command;
  }

  // Codex draws final responses between full-width rules (120 columns in the
  // captured TUI). Cursor-based spinner redraws can leave a few characters on
  // the same logical line, so do not require the rule to be otherwise empty.
  // The 80-column minimum keeps the shorter banner box borders out.
  const responseBlock =
    /(?:^|\n)[^\n]*─{80,}[^\n]*\n([\s\S]*?)\n[^\n]*─{80,}[^\n]*(?=\n|$)/gu;
  for (const match of codexTuiBuffer.matchAll(responseBlock)) {
    consumedThrough = Math.max(consumedThrough, (match.index ?? 0) + match[0].length);
    if (/•\s+Ran\b/u.test(match[1])) continue;

    const firstAnswerBullet = match[1].search(/(?:^|\n)\s*•\s+/u);
    const answerBody = firstAnswerBullet >= 0 ? match[1].slice(firstAnswerBullet) : match[1];
    const answer = answerBody
      .split("\n")
      .map((line) => line.trim().replace(/^•\s*/u, ""))
      .map((line) => line.replace(/\s*›.*$/u, "").trim())
      .filter((line) => line.length >= 8)
      .filter((line) => !/^(?:[A-Za-z]:[\\/]|[/~])\S+$/u.test(line))
      .filter((line) => !/gpt-[\w.-]+\s+(?:high|medium|low)\b/iu.test(line))
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim();
    if (!answer || answer === lastCodexTuiAnswer) continue;

    events.push({
      ts,
      type: "stdout",
      summary: "Codexが回答した",
      detail: answer,
      priority: "notice",
    });
    lastCodexTuiAnswer = answer;
  }

  if (consumedThrough > 0) {
    codexTuiBuffer = codexTuiBuffer.slice(consumedThrough);
  }
  return events;
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

function resolvedSourceId(sourceEnv?: string): string {
  const configured = (sourceEnv ?? "").trim().toLowerCase();
  return configured === "auto" ? getAutoDetectedSource() ?? "generic" : configured;
}

function preprocessLine(rawLine: string, sourceEnv?: string): string | null {
  const normalized = normalizeLine(rawLine);
  if (!normalized) return null;

  const source = resolvedSourceId(sourceEnv);
  if (source !== "generic" && isTerminalRenderingNoise(normalized)) {
    return null;
  }
  if (source === "codex" && isCodexProgressNoise(normalized)) {
    return null;
  }
  if (source === "claude" && isClaudeTuiNoise(normalized)) {
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

  if (source === "codex" && isCodexTuiAssistantLine(normalized)) {
    if (normalized === lastCodexTuiAssistant) return null;
    lastCodexTuiAssistant = normalized;
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

  const rawLines = chunk.split(/\r?\n/);
  if ((sourceEnv ?? "auto").trim().toLowerCase() === "auto" && !getAutoDetectedSource()) {
    for (const rawLine of rawLines) {
      const sourceLine = normalizeLine(rawLine);
      if (!sourceLine) continue;
      rulesForLine(sourceLine, sourceEnv);
      if (getAutoDetectedSource()) break;
    }
  }

  if (resolvedSourceId(sourceEnv) === "claude") {
    const supervisionEvents = extractClaudeSupervisionEvents(chunk, ts);
    if (supervisionEvents.length > 0) return supervisionEvents;
  }

  const events: Event[] = resolvedSourceId(sourceEnv) === "codex"
    ? extractCodexTuiEvents(chunk, ts)
    : [];
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
    } else if (resolvedSourceId(sourceEnv) !== "claude") {
      events.push({ ts, type: "stdout", summary: "ログ更新", detail: line });
    }
  }
  return events;
}
