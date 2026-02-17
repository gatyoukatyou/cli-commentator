export type ServerRuntimeState =
  | "booting"
  | "starting"
  | "pty_running"
  | "file_running"
  | "restarting"
  | "failed"
  | "shutting_down"
  | "stopped";

export type ServerStateEvent = {
  ts: number;
  trigger: string;
  from: ServerRuntimeState;
  to: ServerRuntimeState;
  inputMode: "pty" | "file";
  profileId: string | null;
  detail: string | null;
};

export function buildServerStateEvent(params: {
  trigger: string;
  from: ServerRuntimeState;
  to: ServerRuntimeState;
  inputMode: "pty" | "file";
  profileId: string | null;
  detail?: string | null;
}): ServerStateEvent {
  return {
    ts: Date.now(),
    trigger: params.trigger,
    from: params.from,
    to: params.to,
    inputMode: params.inputMode,
    profileId: params.profileId,
    detail: params.detail ?? null,
  };
}

export function formatServerStateEvent(event: ServerStateEvent): string {
  return `[server/state-event] ${JSON.stringify(event)}`;
}
