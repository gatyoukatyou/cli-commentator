import type { InputMode } from "../types.js";

export function normalizeString(value: string): string {
  return value.trim();
}

export function normalizeOptionalString(value?: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeArgs(args: string[]): string[] {
  return args.map((arg) => arg.trim()).filter(Boolean);
}

export function normalizeOptionalArgs(args?: string[]): string[] | undefined {
  if (args === undefined) return undefined;
  return normalizeArgs(args);
}

export function normalizeInputMode(value?: InputMode): InputMode | undefined {
  if (value === undefined) return undefined;
  return value === "file" ? "file" : "pty";
}

export function parseInputModeFromEnv(env: Record<string, string | undefined>): InputMode {
  return env.INPUT_MODE?.trim().toLowerCase() === "file" ? "file" : "pty";
}

export function getDefaultShell(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    return "powershell.exe";
  }
  return "bash";
}

export function parseTargetArgs(env: Record<string, string | undefined>): string[] {
  if (env.TARGET_ARGS_JSON) {
    try {
      const raw = JSON.parse(env.TARGET_ARGS_JSON);
      if (!Array.isArray(raw) || !raw.every((x) => typeof x === "string")) {
        throw new Error("must be array of strings");
      }
      return raw;
    } catch {
      throw new Error("Invalid TARGET_ARGS_JSON (must be JSON array of strings)");
    }
  }

  if (env.TARGET_ARGS) {
    return env.TARGET_ARGS.split(" ").filter(Boolean);
  }

  return [];
}
