import type { EventPriority } from "../types";
import {
  normalizeSpeechRepetitionKey,
  REPEATED_PROGRESS_SPEECH_WINDOW_MS,
} from "@cli-commentator/shared";

/**
 * 優先度つき読み上げスケジューラ
 * - urgent: 進行中・待機中の発話をすべてキャンセルして即時読み上げ（割り込み）
 * - notice: 進行中の発話を止めず、キュー末尾に追加
 * - progress: 再生中の発話は止めず、再生待ちのprogressだけを最新へ置換する。
 *   ただしurgent/noticeの発話が残っている間は間引き（読み上げない）
 *
 * Web Speech API へは直接依存せず、SpeechSink 経由で発話する（テスト容易性のため）。
 */

export type SpeechSink<Opts> = {
  /** 進行中・待機中の発話をすべて破棄する */
  cancel(reason: SpeechCancellationReason, causeSpeechId?: string): void;
  /** 発話をキューに積む。発話が終了/失敗/破棄されたら onSettled を呼ぶこと */
  speak(request: ScheduledSpeech<Opts>, onSettled: () => void): void;
};

export type SpeechCancellationReason = "urgent_interrupt" | "progress_replace" | "manual_stop";
export type SpeechDropReason = "high_priority_pending" | "repeated_progress" | "progress_replace";
export type SpeechQueueReason = "urgent_interrupt" | "notice_append" | "progress_latest";

export type ScheduledSpeech<Opts> = {
  id: string;
  priority: EventPriority;
  text: string;
  opts: Opts;
  queueDepth: number;
  queueReason: SpeechQueueReason;
};

type SpeechSchedulerOptions<Opts> = {
  nextId?: () => string;
  now?: () => number;
  onDropped?: (request: ScheduledSpeech<Opts>, reason: SpeechDropReason) => void;
};

export type SpeechScheduler<Opts> = {
  /** @returns 発話をキューに積んだら true、間引いた場合は false */
  speak(priority: EventPriority, text: string, opts: Opts): boolean;
  /** すべての発話を破棄し、内部状態をリセットする */
  cancel(): void;
  /** urgent/notice の発話が未消化で残っているか */
  hasPendingHighPriority(): boolean;
};

export function createSpeechScheduler<Opts>(
  sink: SpeechSink<Opts>,
  options: SpeechSchedulerOptions<Opts> = {}
): SpeechScheduler<Opts> {
  // cancel()後に届く古いonSettledを無視するための世代番号
  let generation = 0;
  type QueueEntry = {
    request: Omit<ScheduledSpeech<Opts>, "queueDepth" | "queueReason">;
    isHighPriority: boolean;
    queueReason: SpeechQueueReason;
  };
  let active: QueueEntry | null = null;
  const queued: QueueEntry[] = [];
  let pendingHighCount = 0;
  let pendingTotalCount = 0;
  let fallbackId = 0;
  let lastProgressAtByKey = new Map<string, number>();
  const now = options.now ?? Date.now;

  const toScheduledSpeech = (entry: QueueEntry): ScheduledSpeech<Opts> => ({
    ...entry.request,
    queueDepth: pendingTotalCount,
    queueReason: entry.queueReason,
  });

  const pump = (): void => {
    if (active || queued.length === 0) return;

    const next = queued.shift();
    if (!next) return;
    active = next;
    const submittedGeneration = generation;
    sink.speak(toScheduledSpeech(next), () => {
      if (submittedGeneration !== generation || active?.request.id !== next.request.id) return;
      active = null;
      if (next.isHighPriority) pendingHighCount = Math.max(0, pendingHighCount - 1);
      pendingTotalCount = Math.max(0, pendingTotalCount - 1);
      pump();
    });
  };

  const enqueue = (
    request: Omit<ScheduledSpeech<Opts>, "queueDepth" | "queueReason">,
    isHighPriority: boolean,
    queueReason: SpeechQueueReason
  ): void => {
    queued.push({ request, isHighPriority, queueReason });
    if (isHighPriority) pendingHighCount += 1;
    pendingTotalCount += 1;
    pump();
  };

  const reset = (): void => {
    generation += 1;
    active = null;
    queued.length = 0;
    pendingHighCount = 0;
    pendingTotalCount = 0;
  };

  const drop = (
    request: Omit<ScheduledSpeech<Opts>, "queueDepth" | "queueReason">,
    reason: SpeechDropReason
  ): false => {
    options.onDropped?.({
      ...request,
      queueDepth: pendingTotalCount,
      queueReason: "progress_latest",
    }, reason);
    return false;
  };

  const replaceQueuedProgress = (
    request: Omit<ScheduledSpeech<Opts>, "queueDepth" | "queueReason">
  ): boolean => {
    const index = queued.findIndex(({ request: queuedRequest }) => queuedRequest.priority === "progress");
    if (index < 0) return false;

    const previous = queued[index];
    options.onDropped?.(toScheduledSpeech(previous), "progress_replace");
    queued[index] = {
      request,
      isHighPriority: false,
      queueReason: "progress_latest",
    };
    return true;
  };

  return {
    speak(priority, text, opts) {
      const request = {
        id: options.nextId?.() ?? `speech-${Date.now()}-${++fallbackId}`,
        priority,
        text,
        opts,
      };
      if (priority === "urgent") {
        sink.cancel("urgent_interrupt", request.id);
        reset();
        enqueue(request, true, "urgent_interrupt");
        return true;
      }

      if (priority === "notice") {
        enqueue(request, true, "notice_append");
        return true;
      }

      // progress: 高優先の発話が残っている間は間引く
      if (pendingHighCount > 0) {
        return drop(request, "high_priority_pending");
      }

      const repetitionKey = normalizeSpeechRepetitionKey(text);
      const current = now();
      const lastProgressAt = lastProgressAtByKey.get(repetitionKey);
      if (
        lastProgressAt !== undefined &&
        current - lastProgressAt >= 0 &&
        current - lastProgressAt <= REPEATED_PROGRESS_SPEECH_WINDOW_MS
      ) {
        return drop(request, "repeated_progress");
      }
      lastProgressAtByKey.set(repetitionKey, current);
      if (!replaceQueuedProgress(request)) {
        enqueue(request, false, "progress_latest");
      }
      return true;
    },
    cancel() {
      sink.cancel("manual_stop");
      reset();
      lastProgressAtByKey = new Map();
    },
    hasPendingHighPriority() {
      return pendingHighCount > 0;
    },
  };
}
