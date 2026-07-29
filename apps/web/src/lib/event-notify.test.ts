import { describe, expect, it } from "vitest";
import {
  buildUrgentEventSpeechText,
  createSpokenEventRegistry,
  eventSpeechKey,
  toAttentionNotice,
} from "./event-notify";
import type { Event } from "../types";

describe("event-notify", () => {
  it("イベントから要対応バナー表示用の内容を作る", () => {
    const ev: Event = {
      ts: 1234,
      type: "stdout",
      summary: "許可を待っている",
      detail: "Do you want to proceed?",
      priority: "urgent",
    };
    expect(toAttentionNotice(ev)).toEqual({
      ts: 1234,
      eventType: "stdout",
      summary: "許可を待っている",
      detail: "Do you want to proceed?",
    });
  });

  it("同一イベントを ts と type で相関づけるキーを作る", () => {
    const first: Event = {
      ts: 1234,
      type: "stdout",
      summary: "コマンド実行の確認待ち",
      detail: "pnpm test",
    };
    expect(eventSpeechKey(first)).toBe(eventSpeechKey({ ...first }));
    expect(eventSpeechKey({ ...first, type: "error" })).not.toBe(eventSpeechKey(first));
    expect(eventSpeechKey({ ...first, detail: "git push" })).not.toBe(eventSpeechKey(first));
  });

  it("urgentイベントの定型読み上げ文を作る", () => {
    expect(buildUrgentEventSpeechText({ summary: "許可を待っている" })).toBe(
      "要対応です：許可を待っている。"
    );
    expect(buildUrgentEventSpeechText({ summary: "エラー発生!!" })).toBe(
      "要対応です：エラー発生。"
    );
  });

  it("許可対象を短く要約し、コマンド全文は読み上げない", () => {
    const spoken = buildUrgentEventSpeechText({
      summary: "コマンド実行の確認待ち",
      detail: "Would you like to run the following command?\npnpm test -- --runInBand",
    });
    expect(spoken).toBe("要対応です：「テスト」の実行許可を求めています。");
    expect(spoken).not.toContain("pnpm");
    expect(spoken).not.toContain("--runInBand");
  });

  it("質問待ちは質問番号を含む別の文にする", () => {
    expect(buildUrgentEventSpeechText({
      summary: "質問への回答を待っている",
      detail: "Question 1/1 (1 unanswered)",
    })).toBe("要対応です：質問1への回答を求めています。");
  });

  it("内容が異なる連続した許可要求は別の文にする", () => {
    const testRequest = buildUrgentEventSpeechText({
      summary: "コマンド実行の確認待ち",
      detail: "Would you like to run the following command?\npnpm test",
    });
    const pushRequest = buildUrgentEventSpeechText({
      summary: "コマンド実行の確認待ち",
      detail: "Would you like to run the following command?\ngit push origin topic",
    });

    expect(testRequest).toContain("テスト");
    expect(pushRequest).toContain("変更の共有");
    expect(testRequest).not.toBe(pushRequest);
  });

  describe("createSpokenEventRegistry", () => {
    it("読み上げ済みキーを記録して照合できる", () => {
      const registry = createSpokenEventRegistry();
      expect(registry.has("1:stdout")).toBe(false);
      registry.add("1:stdout");
      expect(registry.has("1:stdout")).toBe(true);
      expect(registry.has("2:stdout")).toBe(false);
    });

    it("重複addしても上限管理が壊れない", () => {
      const registry = createSpokenEventRegistry(2);
      registry.add("a");
      registry.add("a");
      registry.add("b");
      expect(registry.has("a")).toBe(true);
      expect(registry.has("b")).toBe(true);
    });

    it("上限を超えたら古いキーから捨てる", () => {
      const registry = createSpokenEventRegistry(2);
      registry.add("a");
      registry.add("b");
      registry.add("c");
      expect(registry.has("a")).toBe(false);
      expect(registry.has("b")).toBe(true);
      expect(registry.has("c")).toBe(true);
    });
  });
});
