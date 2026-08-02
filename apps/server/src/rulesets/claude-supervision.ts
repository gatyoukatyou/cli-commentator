import type { Event } from "../types.js";
import { ANSI_ESCAPE_RE } from "../terminal-escapes.js";

function normalizeTuiChunk(chunk: string): { readable: string; compact: string } {
  const readable = chunk
    .replace(ANSI_ESCAPE_RE, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    readable,
    compact: readable.replace(/\s+/g, "").toLowerCase(),
  };
}

export function extractClaudeSupervisionEvents(chunk: string, ts = Date.now()): Event[] {
  const { readable, compact } = normalizeTuiChunk(chunk);
  if (!compact) return [];

  const events: Event[] = [];
  const detail = readable.slice(0, 1000);

  if (
    (compact.includes("quicksafetycheck:") && compact.includes("trustthisfolder")) ||
    (compact.includes("requiresapproval") && compact.includes("doyouwanttoproceed?"))
  ) {
    events.push({ ts, type: "stdout", summary: "許可を待っている", detail });
  }

  if (compact.includes("entertoselect") && /(?:1\.|2\.).*(?:3\.|typesomething)/i.test(readable)) {
    events.push({ ts, type: "stdout", summary: "質問への回答を待っている", detail });
  }

  if (
    compact.includes("failedwithexitcode") ||
    compact.includes("commandnotfound") ||
    compact.includes("executionerror")
  ) {
    events.push({ ts, type: "error", summary: "エラーが発生している", detail });
  }

  if (/(?:the )?(?:task|work) is complete\.?$/i.test(readable)) {
    events.push({ ts, type: "done", summary: "作業が完了した", detail });
  }

  return events;
}
