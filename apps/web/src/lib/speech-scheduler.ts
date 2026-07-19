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
  cancel(): void;
  /** 発話をキューに積む。発話が終了/失敗/破棄されたら onSettled を呼ぶこと */
  speak(text: string, opts: Opts, onSettled: () => void): void;
};

export type SpeechScheduler<Opts> = {
  /** @returns 発話をキューに積んだら true、間引いた場合は false */
  speak(priority: EventPriority, text: string, opts: Opts): boolean;
  /** すべての発話を破棄し、内部状態をリセットする */
  cancel(): void;
  /** urgent/notice の発話が未消化で残っているか */
  hasPendingHighPriority(): boolean;
};

export function createSpeechScheduler<Opts>(sink: SpeechSink<Opts>): SpeechScheduler<Opts> {
  // cancel()後に届く古いonSettledを無視するための世代番号
  let generation = 0;
  let pendingHighCount = 0;

  const submit = (text: string, opts: Opts, isHighPriority: boolean): void => {
    const submittedGeneration = generation;
    if (isHighPriority) pendingHighCount += 1;
    sink.speak(text, opts, () => {
      if (submittedGeneration !== generation) return;
      if (isHighPriority) pendingHighCount = Math.max(0, pendingHighCount - 1);
    });
  };

  const reset = (): void => {
    generation += 1;
    pendingHighCount = 0;
  };

  return {
    speak(priority, text, opts) {
      if (priority === "urgent") {
        sink.cancel();
        reset();
        submit(text, opts, true);
        return true;
      }

      if (priority === "notice") {
        submit(text, opts, true);
        return true;
      }

      // progress: 高優先の発話が残っている間は間引く
      if (pendingHighCount > 0) return false;
      sink.cancel();
      reset();
      submit(text, opts, false);
      return true;
    },
    cancel() {
      sink.cancel();
      reset();
    },
    hasPendingHighPriority() {
      return pendingHighCount > 0;
    },
  };
}
