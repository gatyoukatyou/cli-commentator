export type ServerRuntimeState =
  | "booting"
  | "starting"
  | "pty_running"
  | "pty_idle"
  | "file_running"
  | "restarting"
  | "failed"
  | "shutting_down"
  | "stopped";

export type ServerStateEventContextValue = string | number | boolean | null | string[];
export type ServerStateEventContext = Record<string, ServerStateEventContextValue>;
export type ServerStateEventContextInput = Record<string, ServerStateEventContextValue | undefined>;

export type ServerStateEvent = {
  ts: number;
  trigger: string;
  from: ServerRuntimeState;
  to: ServerRuntimeState;
  inputMode: "pty" | "file";
  profileId: string | null;
  detail: string | null;
  context: ServerStateEventContext | null;
};

export function buildServerStateEvent(params: {
  trigger: string;
  from: ServerRuntimeState;
  to: ServerRuntimeState;
  inputMode: "pty" | "file";
  profileId: string | null;
  detail?: string | null;
  context?: ServerStateEventContextInput | null;
}): ServerStateEvent {
  const entries = Object.entries(params.context ?? {}).filter(([, value]) => value !== undefined);
  const context = entries.length > 0 ? (Object.fromEntries(entries) as ServerStateEventContext) : null;
  return {
    ts: Date.now(),
    trigger: params.trigger,
    from: params.from,
    to: params.to,
    inputMode: params.inputMode,
    profileId: params.profileId,
    detail: params.detail ?? null,
    context,
  };
}

export function formatServerStateEvent(event: ServerStateEvent): string {
  return `[server/state-event] ${JSON.stringify(event)}`;
}
