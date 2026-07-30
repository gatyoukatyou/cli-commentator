import {
  COMMENT_TIMEOUT_MS,
  comment,
  type CommentMeasurement,
} from "../commentary/orchestrator.js";
import { withEventPriority, createCommentaryGate } from "../event-priority.js";
import { extractEvents } from "../extract.js";
import { redact } from "../redact.js";
import { createRepeatedErrorDetector } from "../repeated-error-detector.js";
import type { CommentaryPayload, Event, SourceMode, Style, WsOutgoing } from "../types.js";
import { createSessionContext, type SessionPhase } from "../session-context.js";
import { hasRawCommandText } from "../commentary/speech-policy.js";
import { commentByRules } from "../commentary/rule-based.js";
import { applySpeechContract } from "../commentary/speech-policy.js";
import type { ProviderName } from "../llm/types.js";
import { countRepeatedSpeechWithinWindow } from "@cli-commentator/shared";

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
  spokenCommentaries: number;
  displayOnlyCommentaries: number;
  speechSuppressionsByReason: Record<string, number>;
  maxSpeechSentences: number;
  multiSentenceSpeech: number;
  rawCommandSpeech: number;
  repeatedProgressSpeechWithin120s: number;
  glossaryRedisplays: number;
  urgentMisses: number;
  falseUrgent: number;
};

export type PhaseBReplayResult = {
  fixtureId: string;
  source: SourceMode;
  style: Style;
  taskContext: PhaseBTaskContext;
  messages: Array<Extract<WsOutgoing, { kind: "event" | "commentary" }>>;
  contextTimeline: Array<{
    offsetMs: number;
    eventType: Event["type"];
    eventSummary: string;
    sequence: number;
    phase: SessionPhase;
    previousPhase: SessionPhase;
    phaseChanged: boolean;
    targetChanged: boolean;
    target: string | null;
    humanRequired: boolean;
    speechDisposition: "speak" | "display_only";
    speechReason: string;
  }>;
  commentaryComparisons: Array<{
    offsetMs: number;
    eventType: Event["type"];
    withoutContext: Pick<CommentaryPayload, "narration" | "explanation" | "speech">;
    withContext: Pick<CommentaryPayload, "narration" | "explanation" | "speech">;
  }>;
  providerComparisons?: Array<{
    offsetMs: number;
    eventType: Event["type"];
    rules: Pick<CommentaryPayload, "narration" | "explanation" | "speech">;
    llm: Pick<CommentaryPayload, "narration" | "explanation" | "speech">;
    measurement: CommentMeasurement;
  }>;
  providerMetrics?: PhaseBProviderMetrics;
  suppressions: PhaseBSuppression[];
  metrics: PhaseBReplayMetrics;
};

export type PhaseBProviderMetrics = {
  provider: ProviderName;
  model: string;
  timeoutMs: number;
  attempted: number;
  withinTimeoutSuccesses: number;
  withinTimeoutSuccessRate: number;
  results: Record<CommentMeasurement["result"], number>;
  inputTokens: number;
  outputTokens: number;
};

export type PhaseBReplayOptions = {
  llmProvider?: ProviderName;
  llmModel?: string;
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

function speechSentenceCount(text?: string): number {
  const compact = text?.trim();
  if (!compact) return 0;
  return compact.match(/[。！？!?]+/gu)?.length ?? 1;
}

export function hasRawCommandSpeech(text?: string): boolean {
  return hasRawCommandText(text);
}

function expectedUrgent(event: Event): boolean {
  return event.type === "error" ||
    /(?:許可を待っている|質問への回答を待っている|コマンド実行の確認待ち|同じエラーが繰り返されている)/u.test(event.summary);
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
  const spoken = commentaryMessages.filter((message) => message.speech?.disposition === "speak");
  const displayOnly = commentaryMessages.filter(
    (message) => message.speech?.disposition === "display_only"
  );
  const speechSuppressionsByReason: Record<string, number> = {};
  for (const message of displayOnly) {
    const reason = message.speech?.reason ?? "missing";
    speechSuppressionsByReason[reason] = (speechSuppressionsByReason[reason] ?? 0) + 1;
  }
  const glossaryCounts = new Map<string, number>();
  for (const message of commentaryMessages) {
    for (const note of message.glossaryNotes ?? []) {
      glossaryCounts.set(note, (glossaryCounts.get(note) ?? 0) + 1);
    }
  }
  const repeatedProgressSpeechWithin120s = countRepeatedSpeechWithinWindow(
    spoken.flatMap((message) => {
      const text = message.speech?.text;
      return text && message.ev.priority === "progress"
        ? [{ timestampMs: message.ts, text }]
        : [];
    })
  );
  const commentaryByEvent = new Map(
    commentaryMessages.map((message) => [`${message.ev.ts}:${message.ev.type}`, message])
  );
  const urgentEvents = eventMessages.filter((message) => message.ev.priority === "urgent");

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
    spokenCommentaries: spoken.length,
    displayOnlyCommentaries: displayOnly.length,
    speechSuppressionsByReason,
    maxSpeechSentences: Math.max(0, ...spoken.map((message) => speechSentenceCount(message.speech?.text))),
    multiSentenceSpeech: spoken.filter((message) => speechSentenceCount(message.speech?.text) > 1).length,
    rawCommandSpeech: spoken.filter((message) => hasRawCommandSpeech(message.speech?.text)).length,
    repeatedProgressSpeechWithin120s,
    glossaryRedisplays: Array.from(glossaryCounts.values())
      .reduce((total, count) => total + Math.max(0, count - 1), 0),
    urgentMisses: urgentEvents.filter((message) =>
      commentaryByEvent.get(`${message.ev.ts}:${message.ev.type}`)?.speech?.disposition !== "speak"
    ).length,
    falseUrgent: urgentEvents.filter((message) => !expectedUrgent(message.ev)).length,
  };
}

function buildProviderMetrics(
  provider: ProviderName,
  model: string,
  measurements: CommentMeasurement[]
): PhaseBProviderMetrics {
  const results: PhaseBProviderMetrics["results"] = {
    comment_ok: 0,
    comment_timeout: 0,
    comment_aborted: 0,
    comment_llm_error: 0,
  };
  for (const measurement of measurements) {
    results[measurement.result] += 1;
  }
  const withinTimeoutSuccesses = measurements.filter(
    ({ result, durationMs }) => result === "comment_ok" && durationMs <= COMMENT_TIMEOUT_MS
  ).length;
  return {
    provider,
    model,
    timeoutMs: COMMENT_TIMEOUT_MS,
    attempted: measurements.length,
    withinTimeoutSuccesses,
    withinTimeoutSuccessRate:
      measurements.length === 0 ? 0 : withinTimeoutSuccesses / measurements.length,
    results,
    inputTokens: measurements.reduce((total, item) => total + item.inputTokens, 0),
    outputTokens: measurements.reduce((total, item) => total + item.outputTokens, 0),
  };
}

export async function replayPhaseBFixture(
  fixture: PhaseBReplayFixture,
  options: PhaseBReplayOptions = {}
): Promise<PhaseBReplayResult> {
  let currentOffsetMs = 0;
  const gate = createCommentaryGate({
    intervalMs: fixture.commentaryIntervalMs,
    now: () => currentOffsetMs,
  });
  const repeatedErrors = createRepeatedErrorDetector({ now: () => currentOffsetMs });
  const messages: PhaseBReplayResult["messages"] = [];
  const contextTimeline: PhaseBReplayResult["contextTimeline"] = [];
  const commentaryComparisons: PhaseBReplayResult["commentaryComparisons"] = [];
  const providerComparisons: NonNullable<PhaseBReplayResult["providerComparisons"]> = [];
  const providerMeasurements: CommentMeasurement[] = [];
  const suppressions: PhaseBSuppression[] = [];
  const sessionContext = createSessionContext({ now: () => currentOffsetMs });
  sessionContext.setTaskContext({ ...fixture.taskContext, source: "fixture" });

  for (const entry of fixture.lines) {
    currentOffsetMs = entry.offsetMs;
    const events = extractEvents(redact(entry.line), fixture.source);
    for (const extracted of events) {
      const event = withEventPriority(repeatedErrors.observe({ ...extracted, ts: currentOffsetMs }));
      const shouldEmitCommentary = gate.shouldEmit(event.priority);
      const context = sessionContext.observeEvent(event, {
        commentaryEligible: shouldEmitCommentary,
      });
      contextTimeline.push({
        offsetMs: currentOffsetMs,
        eventType: event.type,
        eventSummary: event.summary,
        sequence: context.sequence,
        phase: context.phase,
        previousPhase: context.previousPhase,
        phaseChanged: context.phaseChanged,
        targetChanged: context.targetChanged,
        target: context.target,
        humanRequired: context.humanRequired,
        speechDisposition: context.speech.disposition,
        speechReason: context.speech.reason,
      });
      messages.push({ kind: "event", ev: event });

      if (!shouldEmitCommentary) {
        suppressions.push({ offsetMs: currentOffsetMs, reason: "progress_interval", event });
        continue;
      }

      const providers = {
        narrationProvider: "disabled",
        explanationProvider: "disabled",
      } as const;
      const [withoutContext, payload] = await Promise.all([
        comment(event, fixture.style, providers),
        comment(event, fixture.style, providers, context),
      ]);
      commentaryComparisons.push({
        offsetMs: currentOffsetMs,
        eventType: event.type,
        withoutContext: {
          narration: withoutContext.narration,
          explanation: withoutContext.explanation,
          speech: withoutContext.speech,
        },
        withContext: {
          narration: payload.narration,
          explanation: payload.explanation,
          speech: payload.speech,
        },
      });
      if (options.llmProvider && options.llmProvider !== "disabled") {
        const rules = applySpeechContract(
          commentByRules(event, fixture.style, context),
          event,
          context
        );
        let measurement: CommentMeasurement | undefined;
        const llm = await comment(
          event,
          fixture.style,
          {
            narrationProvider: options.llmProvider,
            explanationProvider: options.llmProvider,
          },
          context,
          (item) => {
            measurement = item;
            providerMeasurements.push(item);
          }
        );
        if (!measurement) {
          throw new Error("LLM commentary completed without a measurement");
        }
        providerComparisons.push({
          offsetMs: currentOffsetMs,
          eventType: event.type,
          rules: {
            narration: rules.narration,
            explanation: rules.explanation,
            speech: rules.speech,
          },
          llm: {
            narration: llm.narration,
            explanation: llm.explanation,
            speech: llm.speech,
          },
          measurement,
        });
      }
      messages.push({ kind: "commentary", ts: currentOffsetMs, ev: event, ...payload });
    }
  }

  const result: PhaseBReplayResult = {
    fixtureId: fixture.id,
    source: fixture.source,
    style: fixture.style,
    taskContext: fixture.taskContext,
    messages,
    contextTimeline,
    commentaryComparisons,
    suppressions,
    metrics: buildMetrics(messages, suppressions),
  };
  if (options.llmProvider && options.llmProvider !== "disabled") {
    result.providerComparisons = providerComparisons;
    result.providerMetrics = buildProviderMetrics(
      options.llmProvider,
      options.llmModel ?? "unknown",
      providerMeasurements
    );
  }
  return result;
}
