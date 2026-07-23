import type { EventPriority } from "../types";

/**
 * 優先度つき読み上げスケジューラ
 * - urgent: 進行中・待機中の発話をすべてキャンセルして即時読み上げ（割り込み）
 * - notice: 進行中の発話を止めず、キュー末尾に追加
 * - progress: 従来のcancel方式（最新のみ）。ただしurgent/noticeの発話が
 *   残っている間は間引き（読み上げない）
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
export type SpeechDropReason = "high_priority_pending";
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
  let pendingHighCount = 0;
  let pendingTotalCount = 0;
  let fallbackId = 0;

  const submit = (
    request: Omit<ScheduledSpeech<Opts>, "queueDepth" | "queueReason">,
    isHighPriority: boolean,
    queueReason: SpeechQueueReason
  ): void => {
    const submittedGeneration = generation;
    if (isHighPriority) pendingHighCount += 1;
    pendingTotalCount += 1;
    sink.speak({ ...request, queueDepth: pendingTotalCount, queueReason }, () => {
      if (submittedGeneration !== generation) return;
      if (isHighPriority) pendingHighCount = Math.max(0, pendingHighCount - 1);
      pendingTotalCount = Math.max(0, pendingTotalCount - 1);
    });
  };

  const reset = (): void => {
    generation += 1;
    pendingHighCount = 0;
    pendingTotalCount = 0;
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
        submit(request, true, "urgent_interrupt");
        return true;
      }

      if (priority === "notice") {
        submit(request, true, "notice_append");
        return true;
      }

      // progress: 高優先の発話が残っている間は間引く
      if (pendingHighCount > 0) {
        options.onDropped?.({
          ...request,
          queueDepth: pendingTotalCount,
          queueReason: "progress_latest",
        }, "high_priority_pending");
        return false;
      }
      sink.cancel("progress_replace", request.id);
      reset();
      submit(request, false, "progress_latest");
      return true;
    },
    cancel() {
      sink.cancel("manual_stop");
      reset();
    },
    hasPendingHighPriority() {
      return pendingHighCount > 0;
    },
  };
}
