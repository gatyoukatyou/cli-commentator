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
    expect(eventSpeechKey(1234, "stdout")).toBe("1234:stdout");
    expect(eventSpeechKey(1234, "error")).not.toBe(eventSpeechKey(1234, "stdout"));
  });

  it("urgentイベントの定型読み上げ文を作る", () => {
    expect(buildUrgentEventSpeechText({ summary: "許可を待っている" })).toBe(
      "要対応です。許可を待っている。"
    );
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
