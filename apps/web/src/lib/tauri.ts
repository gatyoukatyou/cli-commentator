import type { DesktopServerState } from "./recovery";

export type TauriCore = { invoke: (cmd: string) => Promise<unknown> };

export type ServerStatusDetail = {
  state: DesktopServerState;
  pid: number | null;
  started_at: number | null;
  transitioned_at: number | null;
  error: string | null;
  health_ok: boolean;
  last_seen_at: number | null;
  port: number;
};

export const getTauriCore = (): TauriCore | undefined => {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { __TAURI__?: { core?: TauriCore } }).__TAURI__?.core;
};

export const copyWithFallback = async (text: string): Promise<boolean> => {
  if (navigator?.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy copy
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
};
