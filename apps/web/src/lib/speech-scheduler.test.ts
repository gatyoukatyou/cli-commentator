import { describe, expect, it } from "vitest";
import {
  createSpeechScheduler,
  type ScheduledSpeech,
  type SpeechCancellationReason,
  type SpeechSink,
} from "./speech-scheduler";

type Call = { kind: "cancel" } | { kind: "speak"; text: string };

function createFakeSink() {
  const calls: Call[] = [];
  const settlers: Array<() => void> = [];
  const requests: Array<ScheduledSpeech<undefined>> = [];
  const cancelReasons: SpeechCancellationReason[] = [];
  const sink: SpeechSink<undefined> = {
    cancel(reason) {
      calls.push({ kind: "cancel" });
      cancelReasons.push(reason);
    },
    speak(request, onSettled) {
      calls.push({ kind: "speak", text: request.text });
      requests.push(request);
      settlers.push(onSettled);
    },
  };
  return {
    sink,
    calls,
    requests,
    cancelReasons,
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

    expect(fake.calls).toEqual([{ kind: "speak", text: "実況中" }]);
    fake.settle(0);

    expect(fake.calls).toEqual([
      { kind: "speak", text: "実況中" },
      { kind: "speak", text: "完了しました" },
    ]);
  });

  it("progress は再生中の発話をキャンセルせず、終了後に次の発話を読む", () => {
    const fake = createFakeSink();
    const scheduler = createSpeechScheduler(fake.sink);

    expect(scheduler.speak("progress", "1件目", undefined)).toBe(true);
    expect(scheduler.speak("progress", "2件目", undefined)).toBe(true);

    expect(fake.calls).toEqual([{ kind: "speak", text: "1件目" }]);
    expect(fake.cancelReasons).not.toContain("progress_replace");

    fake.settle(0);

    expect(fake.calls).toEqual([
      { kind: "speak", text: "1件目" },
      { kind: "speak", text: "2件目" },
    ]);
  });

  it("再生待ちの通常progressを置き換えず、画面に出た順で保持する", () => {
    const fake = createFakeSink();
    const dropped: Array<{ text: string; reason: string }> = [];
    const scheduler = createSpeechScheduler(fake.sink, {
      onDropped: (request, reason) => dropped.push({ text: request.text, reason }),
    });

    scheduler.speak("progress", "再生中", undefined);
    scheduler.speak("progress", "待機中の古い実況", undefined);
    scheduler.speak("progress", "最新の実況", undefined);

    expect(fake.calls).toEqual([{ kind: "speak", text: "再生中" }]);
    expect(fake.cancelReasons).not.toContain("progress_replace");
    expect(dropped).toEqual([]);

    fake.settle(0);
    expect(fake.calls).toEqual([
      { kind: "speak", text: "再生中" },
      { kind: "speak", text: "待機中の古い実況" },
    ]);
    fake.settle(1);
    expect(fake.calls).toEqual([
      { kind: "speak", text: "再生中" },
      { kind: "speak", text: "待機中の古い実況" },
      { kind: "speak", text: "最新の実況" },
    ]);
  });

  it("heartbeatは通常progressの後ろへ送り、後から来た通常progressを先に読む", () => {
    const fake = createFakeSink();
    const scheduler = createSpeechScheduler(fake.sink);

    scheduler.speak("progress", "再生中の通常実況", undefined);
    scheduler.speak("progress", "待機中のheartbeat", undefined, "heartbeat");
    scheduler.speak("progress", "後続の通常実況", undefined);

    fake.settle(0);
    fake.settle(1);
    fake.settle(2);

    expect(fake.calls.map((call) => call.kind === "speak" ? call.text : "cancel")).toEqual([
      "再生中の通常実況",
      "後続の通常実況",
      "待機中のheartbeat",
    ]);
  });

  it("通常progressが待機中ならheartbeatを抑止する", () => {
    const fake = createFakeSink();
    const dropped: Array<{ text: string; reason: string }> = [];
    const scheduler = createSpeechScheduler(fake.sink, {
      onDropped: (request, reason) => dropped.push({ text: request.text, reason }),
    });

    scheduler.speak("progress", "再生中", undefined);
    scheduler.speak("progress", "未再生の通常実況", undefined);
    expect(scheduler.speak("progress", "定型heartbeat", undefined, "heartbeat")).toBe(false);
    expect(dropped).toEqual([{ text: "定型heartbeat", reason: "heartbeat_suppressed" }]);
  });

  it("120秒以内の同じprogressはスタイル違いでも間引く", () => {
    const fake = createFakeSink();
    const dropped: string[] = [];
    let current = 1_000;
    const scheduler = createSpeechScheduler(fake.sink, {
      now: () => current,
      onDropped: (_request, reason) => dropped.push(reason),
    });

    expect(scheduler.speak("progress", "『設定』を確認しています。", undefined)).toBe(true);
    current += 60_000;
    expect(scheduler.speak("progress", "『設定』を確認しているで。", undefined)).toBe(false);
    expect(dropped).toEqual(["repeated_progress"]);
    expect(fake.calls.filter((call) => call.kind === "speak")).toHaveLength(1);
  });

  it("反復抑止はurgent/noticeに適用せず、cancel後はprogress履歴をリセットする", () => {
    const fake = createFakeSink();
    let current = 1_000;
    const scheduler = createSpeechScheduler(fake.sink, { now: () => current });

    expect(scheduler.speak("progress", "状況を確認しています。", undefined)).toBe(true);
    expect(scheduler.speak("notice", "状況を確認しています。", undefined)).toBe(true);
    expect(scheduler.speak("urgent", "状況を確認しています。", undefined)).toBe(true);
    scheduler.cancel();
    current += 1;
    expect(scheduler.speak("progress", "状況を確認しています。", undefined)).toBe(true);
  });

  it("urgent/notice が未消化でも通常progressを捨てず、後ろで待機させる", () => {
    const fake = createFakeSink();
    const scheduler = createSpeechScheduler(fake.sink);

    scheduler.speak("urgent", "許可待ち", undefined);
    expect(scheduler.hasPendingHighPriority()).toBe(true);
    expect(scheduler.speak("progress", "実況", undefined)).toBe(true);
    expect(fake.calls.filter((call) => call.kind === "speak")).toHaveLength(1);

    // urgent の発話が終了したら待機中のprogressを再開できる
    fake.settle(0);
    expect(scheduler.hasPendingHighPriority()).toBe(false);
    expect(fake.calls).toEqual([
      { kind: "cancel" },
      { kind: "speak", text: "許可待ち" },
      { kind: "speak", text: "実況" },
    ]);
  });

  it("notice が複数積まれても通常progressを後続に保持する", () => {
    const fake = createFakeSink();
    const scheduler = createSpeechScheduler(fake.sink);

    scheduler.speak("notice", "完了1", undefined);
    scheduler.speak("notice", "完了2", undefined);
    fake.settle(0);
    expect(scheduler.speak("progress", "実況", undefined)).toBe(true);
    fake.settle(1);
    expect(fake.calls).toEqual([
      { kind: "speak", text: "完了1" },
      { kind: "speak", text: "完了2" },
      { kind: "speak", text: "実況" },
    ]);
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
    fake.settle(1);
    expect(scheduler.hasPendingHighPriority()).toBe(false);
    expect(scheduler.speak("progress", "実況", undefined)).toBe(true);
  });

  it("assigns stable IDs and records urgent interruption without dropping normal progress", () => {
    const fake = createFakeSink();
    const dropped: Array<{ id: string; reason: string }> = [];
    let id = 0;
    const scheduler = createSpeechScheduler(fake.sink, {
      nextId: () => `speech-${++id}`,
      onDropped: (request, reason) => dropped.push({ id: request.id, reason }),
    });

    expect(scheduler.speak("notice", "完了を追記", undefined)).toBe(true);
    expect(scheduler.speak("progress", "待機する進捗", undefined)).toBe(true);
    expect(scheduler.speak("urgent", "割り込み", undefined)).toBe(true);

    expect(fake.requests.map(({ id, priority, queueDepth, queueReason }) => ({ id, priority, queueDepth, queueReason }))).toEqual([
      { id: "speech-1", priority: "notice", queueDepth: 1, queueReason: "notice_append" },
      { id: "speech-3", priority: "urgent", queueDepth: 1, queueReason: "urgent_interrupt" },
    ]);
    expect(dropped).toEqual([]);
    expect(fake.cancelReasons).toContain("urgent_interrupt");
  });
});
