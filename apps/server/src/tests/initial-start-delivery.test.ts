import { describe, expect, it } from "vitest";
import type {
  InitialStartClient,
  InitialStartCommentary,
  InitialStartEvent,
} from "../runtime/initial-start-delivery.js";
import { createInitialStartDelivery } from "../runtime/initial-start-delivery.js";

const startEvent: InitialStartEvent = {
  kind: "event",
  ev: { ts: 1, type: "start", summary: "開始", detail: "mock CLI" },
};

const startCommentary: InitialStartCommentary = {
  kind: "commentary",
  ts: 2,
  ev: startEvent.ev,
  narration: "開始しています。",
  explanation: "mock CLIを開始しました。",
  speech: { disposition: "speak", reason: "progress_refresh", text: "開始しています。" },
};

function client(open = true): { client: InitialStartClient; sent: InitialStartEvent[] | InitialStartCommentary[] } {
  const sent: Array<InitialStartEvent | InitialStartCommentary> = [];
  return {
    client: {
      isOpen: () => open,
      send: (message) => sent.push(message),
    },
    sent: sent as InitialStartEvent[] | InitialStartCommentary[],
  };
}

describe("initial start delivery", () => {
  it("holds the event until commentary resolves, then delivers both once", () => {
    const delivery = createInitialStartDelivery();
    const first = client();

    expect(delivery.begin(1, startEvent, true)).toBe("buffered");
    expect(delivery.tryDeliver([first.client])).toBe(false);
    delivery.setCommentary(1, startCommentary);

    expect(delivery.tryDeliver([first.client])).toBe(true);
    expect(first.sent).toEqual([startEvent, startCommentary]);
    expect(delivery.tryDeliver([first.client])).toBe(false);
    expect(delivery.isConsumed()).toBe(true);
  });

  it("delivers commentary that resolved before the first connection", () => {
    const delivery = createInitialStartDelivery();
    const first = client();

    expect(delivery.begin(1, startEvent, true)).toBe("buffered");
    delivery.setCommentary(1, startCommentary);
    expect(delivery.tryDeliver([first.client])).toBe(true);
    expect(first.sent).toHaveLength(2);
  });

  it("does not replay consumed payloads after reconnect", () => {
    const delivery = createInitialStartDelivery();
    const first = client();
    const reconnect = client();

    delivery.begin(1, startEvent, true);
    delivery.setCommentary(1, startCommentary);
    expect(delivery.tryDeliver([first.client])).toBe(true);
    expect(delivery.tryDeliver([reconnect.client])).toBe(false);
    expect(reconnect.sent).toEqual([]);
  });

  it("drops an old generation before its delayed commentary resolves", () => {
    const delivery = createInitialStartDelivery();
    const first = client();

    delivery.begin(1, startEvent, true);
    expect(delivery.pendingGeneration()).toBe(1);
    delivery.invalidate(1);
    delivery.setCommentary(1, startCommentary);

    expect(delivery.pendingGeneration()).toBeNull();
    expect(delivery.tryDeliver([first.client])).toBe(false);
    expect(first.sent).toEqual([]);
  });

  it("skips buffering when a client already exists, preserving immediate delivery", () => {
    const delivery = createInitialStartDelivery();
    const first = client();

    expect(delivery.begin(1, startEvent, false)).toBe("immediate");
    delivery.setCommentary(1, startCommentary);
    expect(delivery.tryDeliver([first.client])).toBe(false);
    expect(first.sent).toEqual([]);
  });

  it("waits for a reconnect when the first client is closed", () => {
    const delivery = createInitialStartDelivery();
    const closed = client(false);
    const reconnect = client();

    delivery.begin(1, startEvent, true);
    delivery.setCommentary(1, startCommentary);
    expect(delivery.tryDeliver([closed.client])).toBe(false);
    expect(delivery.tryDeliver([closed.client, reconnect.client])).toBe(true);
    expect(closed.sent).toEqual([]);
    expect(reconnect.sent).toEqual([startEvent, startCommentary]);
  });
});
