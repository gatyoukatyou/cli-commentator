import type { WsOutgoing } from "../types.js";

export type InitialStartEvent = Extract<WsOutgoing, { kind: "event" }>;
export type InitialStartCommentary = Extract<WsOutgoing, { kind: "commentary" }>;
export type InitialStartMessage = InitialStartEvent | InitialStartCommentary;

export type InitialStartClient = {
  isOpen: () => boolean;
  send: (message: InitialStartMessage) => void;
};

export type InitialStartBeginResult = "buffered" | "immediate" | "not-initial";

type PendingStart = {
  generation: number;
  event: InitialStartEvent;
  commentary?: InitialStartCommentary;
};

/**
 * Holds only the first PTY start event and its commentary until a WebSocket
 * client is ready. Later sessions keep the normal immediate broadcast path.
 */
export type InitialStartDelivery = {
  begin: (
    generation: number,
    event: InitialStartEvent,
    shouldBuffer: boolean,
  ) => InitialStartBeginResult;
  setCommentary: (generation: number, commentary: InitialStartCommentary) => void;
  invalidate: (generation?: number) => void;
  tryDeliver: (clients: readonly InitialStartClient[]) => boolean;
  isStarted: () => boolean;
  isConsumed: () => boolean;
  pendingGeneration: () => number | null;
};

export function createInitialStartDelivery(): InitialStartDelivery {
  let started = false;
  let consumed = false;
  let pending: PendingStart | null = null;

  return {
    begin(generation, event, shouldBuffer) {
      if (started) return "not-initial";
      started = true;
      if (!shouldBuffer) {
        consumed = true;
        return "immediate";
      }
      consumed = false;
      pending = { generation, event };
      return "buffered";
    },

    setCommentary(generation, commentary) {
      if (consumed || pending?.generation !== generation) return;
      pending.commentary = commentary;
    },

    invalidate(generation) {
      if (generation !== undefined && pending?.generation !== generation) return;
      pending = null;
      consumed = true;
    },

    tryDeliver(clients) {
      const current = pending;
      if (consumed || !current?.commentary) return false;

      const client = clients.find((candidate) => candidate.isOpen());
      if (!client) return false;

      // Mark consumed before sending so a reconnect cannot replay the event if
      // the second send observes a closing socket.
      consumed = true;
      pending = null;
      client.send(current.event);
      client.send(current.commentary);
      return true;
    },

    isStarted: () => started,
    isConsumed: () => consumed,
    pendingGeneration: () => pending?.generation ?? null,
  };
}
