export type Style = "standard" | "kansai" | "zundamon";
export type DetectedSource = "claude" | "codex" | "generic";
export type SourceMode = "auto" | DetectedSource;
export type SourceState = { mode: SourceMode; detected: DetectedSource | null };

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
  | { kind: "hello"; style: Style; source: SourceState }
  | { kind: "style"; style: Style }
  | { kind: "source"; source: SourceState }
  | { kind: "raw"; data: string }
  | { kind: "event"; ev: Event }
  | { kind: "commentary"; ts: number; text: string; ev: Event };

export type WsIncoming = { kind: "setStyle"; style: Style };
