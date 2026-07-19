import { describe, expect, it } from "vitest";
import { createSpeechScheduler, type SpeechSink } from "./speech-scheduler";

type Call = { kind: "cancel" } | { kind: "speak"; text: string };

function createFakeSink() {
  const calls: Call[] = [];
  const settlers: Array<() => void> = [];
  const sink: SpeechSink<undefined> = {
    cancel() {
      calls.push({ kind: "cancel" });
    },
    speak(text, _opts, onSettled) {
      calls.push({ kind: "speak", text });
      settlers.push(onSettled);
    },
  };
  return {
    sink,
    calls,
    /** n番目にspeakされた発話の終了を通知する */
    settle(index: number) {
      settlers[index]();
    },
  };
}

describe("createSpeechScheduler", () => {
  it("urgent は進行中の発話をキャンセルして即時読み上げる", () => {
    const fake = createFakeSink();
    const scheduler = createSpeechScheduler(fake.sink);

    expect(scheduler.speak("progress", "実況中", undefined)).toBe(true);
    expect(scheduler.speak("urgent", "許可待ち", undefined)).toBe(true);

    expect(fake.calls).toEqual([
      { kind: "cancel" },
      { kind: "speak", text: "実況中" },
      { kind: "cancel" },
      { kind: "speak", text: "許可待ち" },
    ]);
  });

  it("notice はキャンセルせずキュー末尾に追加する", () => {
    const fake = createFakeSink();
    const scheduler = createSpeechScheduler(fake.sink);

    scheduler.speak("progress", "実況中", undefined);
    expect(scheduler.speak("notice", "完了しました", undefined)).toBe(true);

    expect(fake.calls).toEqual([
      { kind: "cancel" },
      { kind: "speak", text: "実況中" },
      { kind: "speak", text: "完了しました" },
    ]);
  });

  it("progress は従来どおり前の発話をキャンセルして最新のみ読み上げる", () => {
    const fake = createFakeSink();
    const scheduler = createSpeechScheduler(fake.sink);

    scheduler.speak("progress", "1件目", undefined);
    scheduler.speak("progress", "2件目", undefined);

    expect(fake.calls).toEqual([
      { kind: "cancel" },
      { kind: "speak", text: "1件目" },
      { kind: "cancel" },
      { kind: "speak", text: "2件目" },
    ]);
  });

  it("urgent/notice が未消化の間、progress は間引かれる", () => {
    const fake = createFakeSink();
    const scheduler = createSpeechScheduler(fake.sink);

    scheduler.speak("urgent", "許可待ち", undefined);
    expect(scheduler.hasPendingHighPriority()).toBe(true);
    expect(scheduler.speak("progress", "実況", undefined)).toBe(false);
    expect(fake.calls.filter((call) => call.kind === "speak")).toHaveLength(1);

    // urgent の発話が終了したら progress を再開できる
    fake.settle(0);
    expect(scheduler.hasPendingHighPriority()).toBe(false);
    expect(scheduler.speak("progress", "実況", undefined)).toBe(true);
  });

  it("notice が複数積まれた場合は全件消化まで progress を間引く", () => {
    const fake = createFakeSink();
    const scheduler = createSpeechScheduler(fake.sink);

    scheduler.speak("notice", "完了1", undefined);
    scheduler.speak("notice", "完了2", undefined);
    fake.settle(0);
    expect(scheduler.speak("progress", "実況", undefined)).toBe(false);
    fake.settle(1);
    expect(scheduler.speak("progress", "実況", undefined)).toBe(true);
  });

  it("cancel() は内部状態をリセットし、古い発話の終了通知を無視する", () => {
    const fake = createFakeSink();
    const scheduler = createSpeechScheduler(fake.sink);

    scheduler.speak("urgent", "許可待ち", undefined);
    scheduler.cancel();
    expect(scheduler.hasPendingHighPriority()).toBe(false);
    expect(scheduler.speak("progress", "実況", undefined)).toBe(true);

    // キャンセル済み発話の遅延onSettledがカウントを壊さない
    fake.settle(0);
    expect(scheduler.hasPendingHighPriority()).toBe(false);
  });

  it("urgent の割り込みはキュー済み notice も破棄して数え直す", () => {
    const fake = createFakeSink();
    const scheduler = createSpeechScheduler(fake.sink);

    scheduler.speak("notice", "完了1", undefined);
    scheduler.speak("notice", "完了2", undefined);
    scheduler.speak("urgent", "エラー発生", undefined);

    // urgent 1件のみが残っている状態
    fake.settle(2);
    expect(scheduler.hasPendingHighPriority()).toBe(false);
    expect(scheduler.speak("progress", "実況", undefined)).toBe(true);
  });
});
