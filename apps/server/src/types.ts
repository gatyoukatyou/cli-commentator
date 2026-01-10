export type Style = "standard" | "kansai" | "zundamon";

export type EventType =
  | "start"
  | "stdout"
  | "stderr"
  | "read"
  | "write"
  | "search"
  | "test"
  | "git"
  | "github"
  | "install"
  | "error"
  | "done";

export type Event = {
  ts: number;
  type: EventType;
  summary: string;
  detail?: string;
};

export type WsOutgoing =
  | { type: "hello"; style: Style }
  | { kind: "style"; style: Style }
  | { kind: "raw"; data: string }
  | { kind: "event"; ev: Event }
  | { kind: "commentary"; ts: number; text: string; ev: Event };

export type WsIncoming = { kind: "setStyle"; style: Style };
