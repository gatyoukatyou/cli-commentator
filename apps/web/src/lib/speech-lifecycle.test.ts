import { describe, expect, it } from "vitest";
import { createSpeechLifecycleRecorder } from "./speech-lifecycle";

describe("speech lifecycle recorder", () => {
  it("exports queue, start, end, cancellation, and drop events with timing metrics", () => {
    let now = 0;
    const recorder = createSpeechLifecycleRecorder({
      now: () => now,
      wallNow: () => Date.parse("2026-07-19T12:00:00.000Z") + now,
      sessionId: () => "session-test",
    });

    recorder.record({
      kind: "queued",
      speechId: "progress-1",
      priority: "progress",
      text: "調査しています。",
      queueDepth: 1,
    });
    now = 120;
    recorder.record({ kind: "started", speechId: "progress-1", priority: "progress", text: "調査しています。" });
    now = 250;
    recorder.record({
      kind: "queued",
      speechId: "notice-1",
      priority: "notice",
      text: "検証が完了しました。",
      queueDepth: 2,
    });
    now = 400;
    recorder.record({
      kind: "cancelled",
      speechId: "progress-1",
      priority: "progress",
      text: "調査しています。",
      reason: "urgent_interrupt",
      causeSpeechId: "urgent-1",
    });
    recorder.record({
      kind: "cancelled",
      speechId: "notice-1",
      priority: "notice",
      text: "検証が完了しました。",
      reason: "urgent_interrupt",
      causeSpeechId: "urgent-1",
    });
    recorder.record({
      kind: "queued",
      speechId: "urgent-1",
      priority: "urgent",
      text: "HUMANの対応が必要です。",
      queueDepth: 1,
    });
    now = 410;
    recorder.record({ kind: "started", speechId: "urgent-1", priority: "urgent", text: "HUMANの対応が必要です。" });
    now = 900;
    recorder.record({ kind: "ended", speechId: "urgent-1", priority: "urgent", text: "HUMANの対応が必要です。" });
    now = 920;
    recorder.record({
      kind: "dropped",
      speechId: "progress-2",
      priority: "progress",
      text: "次を調査しています。",
      reason: "high_priority_pending",
    });

    const exported = recorder.export({ rate: 0.95, voiceURI: "test-voice" });
    expect(exported).toMatchObject({
      schemaVersion: 1,
      session: { id: "session-test", startedAt: "2026-07-19T12:00:00.000Z" },
      settings: { rate: 0.95, voiceURI: "test-voice" },
      metrics: {
        queued: 3,
        started: 2,
        ended: 1,
        cancelled: 2,
        dropped: 1,
        urgentInterruptions: 1,
        noticeQueued: 1,
        progressDropped: 1,
        urgentMisses: 0,
        totalSpeechMs: 770,
        maxQueueWaitMs: 120,
        maxQueueDepth: 2,
      },
    });
    expect(exported.events.map(({ sequence, kind }) => ({ sequence, kind }))).toEqual([
      { sequence: 1, kind: "queued" },
      { sequence: 2, kind: "started" },
      { sequence: 3, kind: "queued" },
      { sequence: 4, kind: "cancelled" },
      { sequence: 5, kind: "cancelled" },
      { sequence: 6, kind: "queued" },
      { sequence: 7, kind: "started" },
      { sequence: 8, kind: "ended" },
      { sequence: 9, kind: "dropped" },
    ]);
  });

  it("detects style-varied repeated progress within 120 seconds and urgent misses", () => {
    let now = 0;
    const recorder = createSpeechLifecycleRecorder({ now: () => now, wallNow: () => now, sessionId: () => "s" });
    const queueAndStart = (speechId: string, priority: "progress" | "urgent", text: string) => {
      recorder.record({ kind: "queued", speechId, priority, text, queueDepth: 1 });
      recorder.record({ kind: "started", speechId, priority, text });
    };
    queueAndStart("p1", "progress", "画面に「対象ファイル」が表示されました。");
    now = 119_999;
    queueAndStart("p2", "progress", "お、画面に「対象ファイル」が出てきたで！");
    now = 120_000;
    queueAndStart("p3", "progress", "画面に「対象ファイル」が出てきたのだ！");
    now = 240_001;
    queueAndStart("p4", "progress", "画面に「対象ファイル」が表示されました。");
    recorder.record({ kind: "queued", speechId: "u1", priority: "urgent", text: "許可待ちです。", queueDepth: 2 });

    expect(recorder.export().metrics).toMatchObject({
      repeatedProgressSpeechWithin120s: 2,
      urgentMisses: 1,
    });
  });

  it("bounds retained events and resets a measurement session", () => {
    let now = 0;
    let session = 0;
    const recorder = createSpeechLifecycleRecorder({
      maxEvents: 3,
      now: () => now,
      wallNow: () => now,
      sessionId: () => `session-${++session}`,
    });
    for (let index = 0; index < 5; index += 1) {
      now = index;
      recorder.record({ kind: "dropped", speechId: `p${index}`, priority: "progress", text: "進捗", reason: "high_priority_pending" });
    }
    expect(recorder.export().events.map((event) => event.speechId)).toEqual(["p2", "p3", "p4"]);
    recorder.reset("launch_session");
    expect(recorder.export()).toMatchObject({
      session: { id: "session-2", trigger: "launch_session" },
      events: [],
    });
  });
});
