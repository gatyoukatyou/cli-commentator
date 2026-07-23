import type { EventPriority } from "../types";

export type SpeechLifecycleKind = "queued" | "started" | "ended" | "cancelled" | "dropped";

export type SpeechLifecycleEventInput = {
  kind: SpeechLifecycleKind;
  speechId: string;
  priority: EventPriority;
  text: string;
  reason?: string;
  causeSpeechId?: string;
  queueDepth?: number;
};

export type SpeechLifecycleEvent = SpeechLifecycleEventInput & {
  sequence: number;
  timestamp: string;
  offsetMs: number;
};

export type SpeechLifecycleMetrics = {
  queued: number;
  started: number;
  ended: number;
  cancelled: number;
  dropped: number;
  urgentInterruptions: number;
  noticeQueued: number;
  progressDropped: number;
  urgentMisses: number;
  repeatedProgressStartsWithin30s: number;
  totalSpeechMs: number;
  averageQueueWaitMs: number;
  maxQueueWaitMs: number;
  maxQueueDepth: number;
  pendingAtExport: number;
};

export type SpeechLifecycleExport = {
  schemaVersion: 1;
  exportedAt: string;
  session: {
    id: string;
    startedAt: string;
    trigger: string;
  };
  settings?: Record<string, unknown>;
  metrics: SpeechLifecycleMetrics;
  events: SpeechLifecycleEvent[];
  truncatedEvents: number;
};

type TrackedSpeech = {
  priority: EventPriority;
  text: string;
  queuedAt: number;
  startedAt: number | null;
};

type RecorderOptions = {
  now?: () => number;
  wallNow?: () => number;
  sessionId?: () => string;
  maxEvents?: number;
};

const DEFAULT_MAX_EVENTS = 2_000;
const REPEATED_PROGRESS_WINDOW_MS = 30_000;

function defaultSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tts-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function boundedText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

export function createSpeechLifecycleRecorder(options: RecorderOptions = {}) {
  const now = options.now ?? (() => performance.now());
  const wallNow = options.wallNow ?? Date.now;
  const sessionId = options.sessionId ?? defaultSessionId;
  const maxEvents = Math.max(1, options.maxEvents ?? DEFAULT_MAX_EVENTS);

  let events: SpeechLifecycleEvent[] = [];
  let sequence = 0;
  let truncatedEvents = 0;
  let sessionStartedAt = now();
  let sessionStartedWall = wallNow();
  let session = { id: sessionId(), trigger: "page_load" };
  let tracked = new Map<string, TrackedSpeech>();
  let lastProgressStartByText = new Map<string, number>();
  let queueWaitTotal = 0;
  let queueWaitSamples = 0;
  let metrics: Omit<SpeechLifecycleMetrics, "urgentMisses" | "averageQueueWaitMs" | "pendingAtExport"> = {
    queued: 0,
    started: 0,
    ended: 0,
    cancelled: 0,
    dropped: 0,
    urgentInterruptions: 0,
    noticeQueued: 0,
    progressDropped: 0,
    repeatedProgressStartsWithin30s: 0,
    totalSpeechMs: 0,
    maxQueueWaitMs: 0,
    maxQueueDepth: 0,
  };
  let urgentQueued = 0;
  let urgentStarted = 0;
  let urgentInterruptCauses = new Set<string>();

  const reset = (trigger = "manual_reset"): void => {
    events = [];
    sequence = 0;
    truncatedEvents = 0;
    sessionStartedAt = now();
    sessionStartedWall = wallNow();
    session = { id: sessionId(), trigger };
    tracked = new Map();
    lastProgressStartByText = new Map();
    queueWaitTotal = 0;
    queueWaitSamples = 0;
    urgentQueued = 0;
    urgentStarted = 0;
    urgentInterruptCauses = new Set();
    metrics = {
      queued: 0,
      started: 0,
      ended: 0,
      cancelled: 0,
      dropped: 0,
      urgentInterruptions: 0,
      noticeQueued: 0,
      progressDropped: 0,
      repeatedProgressStartsWithin30s: 0,
      totalSpeechMs: 0,
      maxQueueWaitMs: 0,
      maxQueueDepth: 0,
    };
  };

  const record = (input: SpeechLifecycleEventInput): void => {
    const current = now();
    const text = boundedText(input.text);
    const event: SpeechLifecycleEvent = {
      ...input,
      text,
      sequence: ++sequence,
      timestamp: new Date(wallNow()).toISOString(),
      offsetMs: Math.max(0, Math.round(current - sessionStartedAt)),
    };
    events.push(event);
    if (events.length > maxEvents) {
      events.shift();
      truncatedEvents += 1;
    }

    if (input.kind === "queued") {
      metrics.queued += 1;
      if (input.priority === "notice") metrics.noticeQueued += 1;
      if (input.priority === "urgent") urgentQueued += 1;
      metrics.maxQueueDepth = Math.max(metrics.maxQueueDepth, input.queueDepth ?? 0);
      tracked.set(input.speechId, {
        priority: input.priority,
        text,
        queuedAt: current,
        startedAt: null,
      });
      return;
    }

    if (input.kind === "dropped") {
      metrics.dropped += 1;
      if (input.priority === "progress") metrics.progressDropped += 1;
      return;
    }

    const speech = tracked.get(input.speechId);
    if (input.kind === "started") {
      metrics.started += 1;
      if (input.priority === "urgent") urgentStarted += 1;
      if (speech) {
        speech.startedAt = current;
        const wait = Math.max(0, current - speech.queuedAt);
        queueWaitTotal += wait;
        queueWaitSamples += 1;
        metrics.maxQueueWaitMs = Math.max(metrics.maxQueueWaitMs, Math.round(wait));
      }
      if (input.priority === "progress") {
        const lastStart = lastProgressStartByText.get(text);
        if (lastStart !== undefined && current - lastStart < REPEATED_PROGRESS_WINDOW_MS) {
          metrics.repeatedProgressStartsWithin30s += 1;
        }
        lastProgressStartByText.set(text, current);
      }
      return;
    }

    if (input.kind === "ended") metrics.ended += 1;
    else {
      metrics.cancelled += 1;
      if (input.reason === "urgent_interrupt") {
        const cause = input.causeSpeechId ?? `event-${event.sequence}`;
        if (!urgentInterruptCauses.has(cause)) {
          urgentInterruptCauses.add(cause);
          metrics.urgentInterruptions += 1;
        }
      }
    }
    if (speech?.startedAt !== null && speech?.startedAt !== undefined) {
      metrics.totalSpeechMs += Math.max(0, Math.round(current - speech.startedAt));
    }
    tracked.delete(input.speechId);
  };

  const exportLog = (settings?: Record<string, unknown>): SpeechLifecycleExport => ({
    schemaVersion: 1,
    exportedAt: new Date(wallNow()).toISOString(),
    session: {
      ...session,
      startedAt: new Date(sessionStartedWall).toISOString(),
    },
    ...(settings ? { settings: { ...settings } } : {}),
    metrics: {
      ...metrics,
      urgentMisses: Math.max(0, urgentQueued - urgentStarted),
      averageQueueWaitMs: queueWaitSamples > 0 ? Math.round(queueWaitTotal / queueWaitSamples) : 0,
      pendingAtExport: tracked.size,
    },
    events: events.map((event) => ({ ...event })),
    truncatedEvents,
  });

  return { record, reset, export: exportLog };
}

export type SpeechLifecycleRecorder = ReturnType<typeof createSpeechLifecycleRecorder>;
