import type { PtyFailure } from "./unavailable.js";

export type PtyFailureContext = "startup" | "restart";

export type PtyFailureCode =
  | "node_pty_unavailable"
  | "target_command_not_found"
  | "target_cwd_not_found"
  | "target_permission_denied"
  | "invalid_target_args_json"
  | "unknown";

export type FileFallbackResult = {
  attempted: boolean;
  activated: boolean;
  reason:
    | "not_attempted"
    | "activated"
    | "already_active"
    | "missing_input_file"
    | "file_not_found"
    | "start_failed";
};

export type PtyStartupFailureLog = {
  context: PtyFailureContext;
  kind: PtyFailure["kind"];
  code: PtyFailureCode;
  error: string;
  inputMode: "pty" | "file";
  fallback: FileFallbackResult;
};

export function classifyPtyStartupFailureCode(failure: PtyFailure): PtyFailureCode {
  if (failure.kind === "ptyUnavailable") {
    return "node_pty_unavailable";
  }

  const message = failure.error.toLowerCase();
  if (message.includes("node-pty not available")) {
    return "node_pty_unavailable";
  }
  if (message.includes("invalid target_args_json")) {
    return "invalid_target_args_json";
  }
  if (message.includes("eacces") || message.includes("eperm")) {
    return "target_permission_denied";
  }
  if (message.includes("enoent")) {
    if (message.includes("cwd") || message.includes("working directory")) {
      return "target_cwd_not_found";
    }
    return "target_command_not_found";
  }
  return "unknown";
}

export function buildPtyStartupFailureLog(params: {
  context: PtyFailureContext;
  failure: PtyFailure;
  inputMode: "pty" | "file";
  fallback: FileFallbackResult;
}): PtyStartupFailureLog {
  return {
    context: params.context,
    kind: params.failure.kind,
    code: classifyPtyStartupFailureCode(params.failure),
    error: params.failure.error,
    inputMode: params.inputMode,
    fallback: params.fallback,
  };
}

export function formatPtyStartupFailureLog(payload: PtyStartupFailureLog): string {
  return `[startup/failure] ${JSON.stringify(payload)}`;
}
