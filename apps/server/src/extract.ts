import type { Event } from "./types.js";
import { rulesForLine } from "./rulesets/index.js";

export function extractEvents(chunk: string): Event[] {
  const ts = Date.now();
  const lines = chunk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const events: Event[] = [];
  for (const line of lines) {
    const rules = rulesForLine(line, process.env.LOG_SOURCE);
    const hit = rules.find((rule) => rule.re.test(line));
    if (hit) events.push({ ts, type: hit.type, summary: hit.summary, detail: line });
    else events.push({ ts, type: "stdout", summary: "ログ更新", detail: line });
  }
  return events;
}
