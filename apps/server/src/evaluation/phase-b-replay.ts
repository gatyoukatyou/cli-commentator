import { comment } from "../commentary/orchestrator.js";
import { withEventPriority, createCommentaryGate } from "../event-priority.js";
import { extractEvents } from "../extract.js";
import { redact } from "../redact.js";
import { createRepeatedErrorDetector } from "../repeated-error-detector.js";
import type { CommentaryPayload, Event, SourceMode, Style, WsOutgoing } from "../types.js";

export type PhaseBReplayFixture = {
  notice: string[];
  id: string;
  source: SourceMode;
  style: Style;
  taskContext: PhaseBTaskContext;
  commentaryIntervalMs: number;
  lines: Array<{ offsetMs: number; line: string }>;
};

export type PhaseBTaskContext = {
  objective: string;
  userPrompt: string;
};

export type PhaseBSuppression = {
  offsetMs: number;
  reason: "progress_interval";
  event: Event;
};

export type PhaseBReplayMetrics = {
  events: number;
  commentaries: number;
  suppressed: number;
  eventsByType: Record<string, number>;
  glossaryNotes: number;
  exactNarrationRepeats: number;
};

export type PhaseBReplayResult = {
  fixtureId: string;
  source: SourceMode;
  style: Style;
  taskContext: PhaseBTaskContext;
  messages: Array<Extract<WsOutgoing, { kind: "event" | "commentary" }>>;
  suppressions: PhaseBSuppression[];
  metrics: PhaseBReplayMetrics;
};

export type PhaseBEventTypeComparison = {
  eventType: string;
  baseline: number;
  candidate: number;
};

export function comparePhaseBEventTypes(
  baseline: PhaseBReplayMetrics,
  candidate: PhaseBReplayMetrics
): PhaseBEventTypeComparison[] {
  const eventTypes = new Set([
    ...Object.keys(baseline.eventsByType),
    ...Object.keys(candidate.eventsByType),
  ]);
  return Array.from(eventTypes)
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((eventType) => ({
      eventType,
      baseline: baseline.eventsByType[eventType] ?? 0,
      candidate: candidate.eventsByType[eventType] ?? 0,
    }));
}

function countExactNarrationRepeats(messages: PhaseBReplayResult["messages"]): number {
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (message.kind !== "commentary" || !message.narration) continue;
    counts.set(message.narration, (counts.get(message.narration) ?? 0) + 1);
  }
  return Array.from(counts.values()).reduce((total, count) => total + Math.max(0, count - 1), 0);
}

function buildMetrics(
  messages: PhaseBReplayResult["messages"],
  suppressions: PhaseBSuppression[]
): PhaseBReplayMetrics {
  const eventMessages = messages.filter((message): message is Extract<WsOutgoing, { kind: "event" }> =>
    message.kind === "event"
  );
  const commentaryMessages = messages.filter(
    (message): message is Extract<WsOutgoing, { kind: "commentary" }> => message.kind === "commentary"
  );
  const eventsByType: Record<string, number> = {};
  for (const message of eventMessages) {
    eventsByType[message.ev.type] = (eventsByType[message.ev.type] ?? 0) + 1;
  }

  return {
    events: eventMessages.length,
    commentaries: commentaryMessages.length,
    suppressed: suppressions.length,
    eventsByType,
    glossaryNotes: commentaryMessages.reduce(
      (total, message) => total + (message.glossaryNotes?.length ?? 0),
      0
    ),
    exactNarrationRepeats: countExactNarrationRepeats(messages),
  };
}

export async function replayPhaseBFixture(fixture: PhaseBReplayFixture): Promise<PhaseBReplayResult> {
  let currentOffsetMs = 0;
  const gate = createCommentaryGate({
    intervalMs: fixture.commentaryIntervalMs,
    now: () => currentOffsetMs,
  });
  const repeatedErrors = createRepeatedErrorDetector({ now: () => currentOffsetMs });
  const messages: PhaseBReplayResult["messages"] = [];
  const suppressions: PhaseBSuppression[] = [];

  for (const entry of fixture.lines) {
    currentOffsetMs = entry.offsetMs;
    const events = extractEvents(redact(entry.line), fixture.source);
    for (const extracted of events) {
      const event = withEventPriority(repeatedErrors.observe({ ...extracted, ts: currentOffsetMs }));
      messages.push({ kind: "event", ev: event });

      if (!gate.shouldEmit(event.priority)) {
        suppressions.push({ offsetMs: currentOffsetMs, reason: "progress_interval", event });
        continue;
      }

      const payload: CommentaryPayload = await comment(event, fixture.style, {
        narrationProvider: "disabled",
        explanationProvider: "disabled",
      });
      messages.push({ kind: "commentary", ts: currentOffsetMs, ev: event, ...payload });
    }
  }

  return {
    fixtureId: fixture.id,
    source: fixture.source,
    style: fixture.style,
    taskContext: fixture.taskContext,
    messages,
    suppressions,
    metrics: buildMetrics(messages, suppressions),
  };
}
