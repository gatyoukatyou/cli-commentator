import type { Event } from "./types.js";
import { tokenizeShellCommand, unwrapCommandDetail } from "./command-analysis.js";
import { redact } from "./redact.js";

export type SessionPhase =
  | "unknown"
  | "investigation"
  | "editing"
  | "verification"
  | "publishing"
  | "waiting";

export type TaskContextSource = "fixture" | "human_input" | "human_log" | "preset";

export type SessionTaskContext = {
  objective: string | null;
  userPrompt: string | null;
  source: TaskContextSource | null;
};

export type SessionEventSummary = {
  sequence: number;
  type: Event["type"];
  summary: string;
  target: string | null;
};

export type SessionContextSnapshot = Readonly<{
  task: Readonly<SessionTaskContext>;
  target: string | null;
  recentEvents: readonly Readonly<SessionEventSummary>[];
  phase: SessionPhase;
  previousPhase: SessionPhase;
  phaseChanged: boolean;
  humanRequired: boolean;
  sequence: number;
}>;

export type SessionContext = {
  setTaskContext(input: {
    objective?: string | null;
    userPrompt?: string | null;
    source: TaskContextSource;
  }): void;
  observeInput(data: string): void;
  observeEvent(event: Event): SessionContextSnapshot;
  snapshot(): SessionContextSnapshot;
  reset(options?: { presetName?: string; acceptsHumanInput?: boolean }): void;
};

type MutableState = {
  task: SessionTaskContext;
  target: string | null;
  recentEvents: SessionEventSummary[];
  phase: SessionPhase;
  previousPhase: SessionPhase;
  phaseChanged: boolean;
  humanRequired: boolean;
  sequence: number;
  phaseBeforeWaiting: SessionPhase;
  inputBuffer: string;
  acceptsHumanInput: boolean;
};

const DEFAULT_HISTORY_LIMIT = 5;
const MAX_CONTEXT_LENGTH = 320;
const MAX_INPUT_BUFFER_LENGTH = MAX_CONTEXT_LENGTH * 2;
const MAX_SUMMARY_LENGTH = 120;
const MAX_TARGET_LENGTH = 160;

export const SESSION_PHASE_LABELS: Record<SessionPhase, string> = {
  unknown: "未判定",
  investigation: "調査",
  editing: "編集",
  verification: "検証",
  publishing: "公開",
  waiting: "待機",
};

function limited(value: string | null | undefined, max: number): string | null {
  const compact = redact(value ?? "").replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length <= max ? compact : `${compact.slice(0, max - 1).trimEnd()}…`;
}

function isWaitingEvent(event: Event): boolean {
  const text = `${event.summary} ${event.detail ?? ""}`;
  return /(?:確認待ち|許可を待|承認待ち|回答を待|入力待ち|質問への回答|長考・沈黙)/u.test(text);
}

function explicitlyRequiresHuman(event: Event): boolean {
  const text = `${event.summary} ${event.detail ?? ""}`;
  return /(?:確認待ち|許可を待|承認待ち|回答を待|入力待ち|質問への回答|HUMAN(?:の)?(?:判断|対応))/iu.test(text);
}

function isHumanResponseEvent(event: Event): boolean {
  const text = `${event.summary} ${event.detail ?? ""}`;
  return /(?:承認された|approved|入力を受け付け|回答済み)/iu.test(text);
}

function isPublishingOperation(event: Event): boolean {
  if (event.type !== "git" && event.type !== "github") return false;
  const command = unwrapCommandDetail(event.detail ?? "");
  return (
    /\bgit\s+(?:commit|push)\b/i.test(command) ||
    /\bgh\s+pr\s+(?:create|edit|comment|merge|ready)\b/i.test(command) ||
    /\bgh\s+release\s+(?:create|upload|edit)\b/i.test(command)
  );
}

function verificationCommand(event: Event): boolean {
  if (event.type !== "stdout" && event.type !== "install") return false;
  const detail = event.detail ?? "";
  if (!/^[⏺•]\s*Bash\(|^>\s/u.test(detail)) return false;
  const tokens = tokenizeShellCommand(unwrapCommandDetail(detail));
  if (!tokens) return false;

  const valueOptions = new Set([
    "-C", "--dir", "--filter", "--prefix", "-w", "--workspace", "--cwd",
  ]);
  for (let index = 0; index < tokens.length; index += 1) {
    const manager = tokens[index].replace(/\\/g, "/").split("/").at(-1)?.toLowerCase();
    if (!manager || !["pnpm", "npm", "yarn"].includes(manager)) continue;

    let actionAt = index + 1;
    while (actionAt < tokens.length && tokens[actionAt].startsWith("-")) {
      const option = tokens[actionAt];
      actionAt += 1;
      if (valueOptions.has(option)) actionAt += 1;
    }
    if (manager === "yarn" && tokens[actionAt] === "workspace") actionAt += 2;
    if (tokens[actionAt] === "run") actionAt += 1;
    if (/^(?:test|typecheck|build|lint)(?::|$)/i.test(tokens[actionAt] ?? "")) return true;
  }
  return false;
}

function explicitPhaseFor(event: Event): SessionPhase | null {
  if (isWaitingEvent(event)) return "waiting";
  if (isPublishingOperation(event)) return "publishing";
  if (event.type === "write") return "editing";
  if (
    event.type === "test" ||
    event.type === "lint" ||
    event.type === "build" ||
    verificationCommand(event)
  ) return "verification";
  if (event.type === "read" || event.type === "search") return "investigation";
  return null;
}

function nextPhase(state: MutableState, event: Event): SessionPhase {
  const explicit = explicitPhaseFor(event);
  if (explicit === "waiting") return explicit;

  if (state.phase === "waiting") {
    if (explicit) return explicit;
    if (isHumanResponseEvent(event)) return state.phaseBeforeWaiting;
    if (["start", "stderr", "error", "done"].includes(event.type)) return state.phase;
    return state.phaseBeforeWaiting;
  }

  if (!explicit) return state.phase;

  // Phase transition table:
  // - read/search starts or maintains investigation.
  // - write always advances to editing.
  // - test/lint/build advances to verification.
  // - commit/push/explicit PR publication advances to publishing.
  // - a supporting read/search never moves editing, verification, or publishing back
  //   to investigation; a new write or verification event can still start the next cycle.
  if (
    explicit === "investigation" &&
    (state.phase === "editing" || state.phase === "verification" || state.phase === "publishing")
  ) {
    return state.phase;
  }
  return explicit;
}

function pathLike(token: string): boolean {
  return (
    /(?:^|\/)\.?[A-Za-z0-9_.-]+\.[A-Za-z0-9]+(?::\d+)?$/u.test(token) ||
    /^(?:apps|packages|src|test|tests|docs|scripts)\//u.test(token)
  );
}

function cleanTarget(value: string): string | null {
  return limited(value.replace(/^["']|["'),;:]$/g, ""), MAX_TARGET_LENGTH);
}

export function inferEventTarget(event: Event): string | null {
  const detail = event.detail?.trim();
  if (!detail) return null;

  const wrapped = detail.match(/^[⏺•]\s*(?:Read|Update|Write|Grep|Glob)\((.*)\)$/s)?.[1];
  const command = wrapped ?? unwrapCommandDetail(detail);
  const tokens = tokenizeShellCommand(command) ?? command.split(/\s+/);
  const candidates = tokens
    .filter((token) => !token.startsWith("-") && pathLike(token))
    .map(cleanTarget)
    .filter((token): token is string => Boolean(token));

  return candidates[0] ?? null;
}

function initialState(): MutableState {
  return {
    task: { objective: null, userPrompt: null, source: null },
    target: null,
    recentEvents: [],
    phase: "unknown",
    previousPhase: "unknown",
    phaseChanged: false,
    humanRequired: false,
    sequence: 0,
    phaseBeforeWaiting: "unknown",
    inputBuffer: "",
    acceptsHumanInput: false,
  };
}

function immutableSnapshot(state: MutableState): SessionContextSnapshot {
  const task = Object.freeze({ ...state.task });
  const recentEvents = Object.freeze(state.recentEvents.map((event) => Object.freeze({ ...event })));
  return Object.freeze({
    task,
    target: state.target,
    recentEvents,
    phase: state.phase,
    previousPhase: state.previousPhase,
    phaseChanged: state.phaseChanged,
    humanRequired: state.humanRequired,
    sequence: state.sequence,
  });
}

function looksLikeHumanRequest(line: string): boolean {
  if (line.length < 4 || /^[/:.\w-]+$/u.test(line)) return false;
  if (/^(?:codex|claude|exit|quit|clear|help)$/i.test(line)) return false;
  return true;
}

function appendTerminalInput(buffer: string, data: string): string {
  let next = buffer;
  const clean = data.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  for (const char of clean) {
    if (char === "\u0003" || char === "\u0015") {
      next = "";
    } else if (char === "\b" || char === "\u007f") {
      next = Array.from(next).slice(0, -1).join("");
    } else {
      next += char;
    }
  }
  return next;
}

export function createSessionContext(options?: { historyLimit?: number }): SessionContext {
  const historyLimit = Math.min(5, Math.max(3, options?.historyLimit ?? DEFAULT_HISTORY_LIMIT));
  let state = initialState();

  return {
    setTaskContext(input) {
      const objective = limited(input.objective, MAX_CONTEXT_LENGTH);
      const userPrompt = limited(input.userPrompt, MAX_CONTEXT_LENGTH);
      state.task = {
        objective,
        userPrompt,
        source: objective || userPrompt ? input.source : null,
      };
    },

    observeInput(data) {
      if (!state.acceptsHumanInput || state.task.source === "fixture") return;
      state.inputBuffer = appendTerminalInput(state.inputBuffer, data);
      if (state.inputBuffer.length > MAX_INPUT_BUFFER_LENGTH) {
        state.inputBuffer = state.inputBuffer.slice(-MAX_INPUT_BUFFER_LENGTH);
      }
      const parts = state.inputBuffer.split(/\r\n|\n|\r/);
      state.inputBuffer = parts.pop() ?? "";
      for (const part of parts) {
        const prompt = limited(part, MAX_CONTEXT_LENGTH);
        if (prompt && looksLikeHumanRequest(prompt)) {
          state.task = { objective: prompt, userPrompt: prompt, source: "human_input" };
        }
      }
    },

    observeEvent(event) {
      state.sequence += 1;
      const target = inferEventTarget(event);
      if (target) state.target = target;

      const priorPhase = state.phase;
      const resolvedPhase = nextPhase(state, event);
      if (resolvedPhase === "waiting" && priorPhase !== "waiting") {
        state.phaseBeforeWaiting = priorPhase;
      }
      state.previousPhase = priorPhase;
      state.phase = resolvedPhase;
      state.phaseChanged = priorPhase !== resolvedPhase;

      if (explicitlyRequiresHuman(event)) state.humanRequired = true;
      else if (
        isHumanResponseEvent(event) ||
        (priorPhase === "waiting" && resolvedPhase !== "waiting") ||
        (!isWaitingEvent(event) && explicitPhaseFor(event) !== null)
      ) {
        state.humanRequired = false;
      }

      state.recentEvents.push({
        sequence: state.sequence,
        type: event.type,
        summary: limited(event.summary, MAX_SUMMARY_LENGTH) ?? event.type,
        target: target ?? state.target,
      });
      state.recentEvents = state.recentEvents.slice(-historyLimit);
      return immutableSnapshot(state);
    },

    snapshot() {
      return immutableSnapshot(state);
    },

    reset(resetOptions) {
      state = initialState();
      state.acceptsHumanInput = resetOptions?.acceptsHumanInput ?? false;
      const presetName = limited(resetOptions?.presetName, MAX_CONTEXT_LENGTH);
      if (presetName) {
        state.task = { objective: presetName, userPrompt: null, source: "preset" };
      }
    },
  };
}
