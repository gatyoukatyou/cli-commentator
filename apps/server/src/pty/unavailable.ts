import type { WsOutgoing } from "../types.js";

export const PTY_UNAVAILABLE_SUGGESTION =
  "INPUT_MODE=file INPUT_FILE=/path/to/log pnpm dev:server で file 監視モードが使用可能です。";

export type PtyFailure =
  | { kind: "ptyUnavailable"; error: string }
  | { kind: "ptyError"; error: string };

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function classifyPtyFailure(err: unknown, nodePtyError: string | null): PtyFailure {
  const errorMessage = getErrorMessage(err);
  if (nodePtyError) {
    return { kind: "ptyUnavailable", error: nodePtyError };
  }
  if (errorMessage.includes("node-pty not available")) {
    return { kind: "ptyUnavailable", error: errorMessage };
  }
  return { kind: "ptyError", error: errorMessage };
}

export function createPtyUnavailableMessage(
  error: string,
  suggestion: string = PTY_UNAVAILABLE_SUGGESTION
): Extract<WsOutgoing, { kind: "ptyUnavailable" }> {
  return {
    kind: "ptyUnavailable",
    error,
    suggestion,
  };
}
