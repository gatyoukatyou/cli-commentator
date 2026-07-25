import {
  SESSION_PHASE_LABELS,
  type SessionPhase,
} from "../session-context.js";
import type { PhaseBReplayResult } from "./phase-b-replay.js";

type EvaluatedSessionPhase = Exclude<SessionPhase, "unknown">;

export type PhaseBPhaseOption = {
  phase: EvaluatedSessionPhase;
  label: string;
};

export type PhaseBCheckpoint = {
  cpId: string;
  offsetMs: number;
  phase: EvaluatedSessionPhase;
  phaseLabel: string;
  humanRequired: boolean;
  objective: string;
};

export type PhaseBCheckpointAnswerKey = {
  fixtureId: string;
  phaseOptions: PhaseBPhaseOption[];
  checkpoints: PhaseBCheckpoint[];
  skippedCheckpoints: PhaseBSkippedCheckpoint[];
};

export type PhaseBBlindSpeechItem = {
  cpId: string;
  speechText: string;
};

export type PhaseBSkippedCheckpoint = {
  offsetMs: number;
  eventType: string;
  reason: "speech_not_spoken" | "missing_speech_text";
  speechDisposition: "speak" | "display_only" | "missing";
  speechReason: string;
};

export type PhaseBEvaluationArtifacts = {
  answerKey: PhaseBCheckpointAnswerKey;
  blindSpeech: PhaseBBlindSpeechItem[];
};

export function evaluatedPhaseOptions(): PhaseBPhaseOption[] {
  return (Object.entries(SESSION_PHASE_LABELS) as Array<[SessionPhase, string]>)
    .filter((entry): entry is [EvaluatedSessionPhase, string] => entry[0] !== "unknown")
    .map(([phase, label]) => ({ phase, label }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function sanitizeBlindSpeechText(text: string): string {
  const phaseLabels = evaluatedPhaseOptions()
    .map(({ label }) => label)
    .sort((left, right) => right.length - left.length);
  const phaseLabelPattern = new RegExp(
    phaseLabels.map(escapeRegExp).join("|"),
    "gu"
  );
  return text.replace(phaseLabelPattern, "作業").replace(/\s+/gu, " ").trim();
}

export function buildPhaseBEvaluationArtifacts(
  result: PhaseBReplayResult
): PhaseBEvaluationArtifacts {
  const checkpoints: PhaseBCheckpoint[] = [];
  const blindSpeech: PhaseBBlindSpeechItem[] = [];
  const skippedCheckpoints: PhaseBSkippedCheckpoint[] = [];
  let timelineAt = 0;

  for (const commentary of result.commentaryComparisons) {
    const matchingIndex = result.contextTimeline.findIndex(
      ({ offsetMs, eventType }, index) =>
        index >= timelineAt &&
        offsetMs === commentary.offsetMs &&
        eventType === commentary.eventType
    );
    if (matchingIndex < 0) {
      throw new Error(
        `Missing context timeline entry for commentary at ${commentary.offsetMs}ms`
      );
    }
    timelineAt = matchingIndex + 1;

    const context = result.contextTimeline[matchingIndex];
    if (context.phase === "unknown") continue;

    const speech = commentary.withContext.speech;
    if (speech?.disposition !== "speak") {
      skippedCheckpoints.push({
        offsetMs: commentary.offsetMs,
        eventType: commentary.eventType,
        reason: "speech_not_spoken",
        speechDisposition: speech?.disposition ?? "missing",
        speechReason: speech?.reason ?? context.speechReason,
      });
      continue;
    }

    const speechText = speech.text?.trim();
    if (!speechText) {
      skippedCheckpoints.push({
        offsetMs: commentary.offsetMs,
        eventType: commentary.eventType,
        reason: "missing_speech_text",
        speechDisposition: "speak",
        speechReason: speech.reason,
      });
      continue;
    }

    const cpId = `CP-${String(checkpoints.length + 1).padStart(3, "0")}`;
    checkpoints.push({
      cpId,
      offsetMs: commentary.offsetMs,
      phase: context.phase,
      phaseLabel: SESSION_PHASE_LABELS[context.phase],
      humanRequired: context.humanRequired,
      objective: result.taskContext.objective,
    });
    blindSpeech.push({
      cpId,
      speechText: sanitizeBlindSpeechText(speechText),
    });
  }

  return {
    answerKey: {
      fixtureId: result.fixtureId,
      phaseOptions: evaluatedPhaseOptions(),
      checkpoints,
      skippedCheckpoints,
    },
    blindSpeech,
  };
}
