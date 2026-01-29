import { createRequire } from "node:module";
import type { Profile } from "../profile/types.js";

// Local type definitions (to avoid runtime import of node-pty)
type IPty = {
  onData: (cb: (data: string) => void) => { dispose: () => void };
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => { dispose: () => void };
  write: (data: string) => void;
  kill: (signal?: string) => void;
  resize: (cols: number, rows: number) => void;
};

type IPtyForkOptions = {
  name?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
  useConpty?: boolean;
};

type NodePty = {
  spawn: (cmd: string, args: string[], options: IPtyForkOptions) => IPty;
};

// Lazy-loaded node-pty state
let nodePty: NodePty | null = null;
let nodePtyError: string | null = null;

/**
 * Lazily load node-pty module.
 * Throws if node-pty is not available (e.g., build failed on Windows without Visual C++ Build Tools).
 */
function loadNodePty(): NodePty {
  if (nodePty) return nodePty;
  if (nodePtyError) throw new Error(nodePtyError);

  try {
    const require = createRequire(import.meta.url);
    nodePty = require("node-pty") as NodePty;
    return nodePty;
  } catch (err) {
    nodePtyError = `node-pty not available: ${err instanceof Error ? err.message : String(err)}. Use INPUT_MODE=file for file monitoring mode.`;
    throw new Error(nodePtyError);
  }
}

/**
 * Check if node-pty is available without throwing.
 */
export function isNodePtyAvailable(): boolean {
  try {
    loadNodePty();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the error message if node-pty failed to load.
 */
export function getNodePtyError(): string | null {
  return nodePtyError;
}

/**
 * PTY configuration for spawning a terminal
 */
export type PTYConfig = {
  cmd: string;
  args: string[];
  cwd: string;
  cols?: number;
  rows?: number;
};

/**
 * Get the default shell for the current platform
 */
function getDefaultShell(): string {
  if (process.platform === "win32") {
    return "powershell.exe";
  }
  return "bash";
}

/**
 * Determine whether to use ConPTY on Windows
 * Environment variable takes precedence, otherwise detect debugger
 */
function shouldUseConpty(): boolean {
  const envValue = process.env.PTY_USE_CONPTY?.toLowerCase();

  // Environment variable takes precedence if explicitly set
  if (envValue === "0" || envValue === "false" || envValue === "off") {
    return false;
  }
  if (envValue === "1" || envValue === "true" || envValue === "on") {
    return true;
  }

  // If not set, detect debugger and disable ConPTY if found
  const nodeOptions = process.env.NODE_OPTIONS ?? "";
  const hasInspect =
    process.execArgv.some(
      (arg) => arg.includes("--inspect") || arg.includes("--inspect-brk")
    ) ||
    nodeOptions.includes("--inspect") ||
    nodeOptions.includes("--inspect-brk");

  if (hasInspect) {
    return false;
  }

  return true;
}

/**
 * PTY Manager interface for managing terminal lifecycle
 */
export type PTYManager = {
  readonly current: IPty | null;
  spawn: (config: PTYConfig) => IPty;
  kill: () => void;
  write: (data: string) => void;
};

/**
 * Create a PTY manager instance
 */
export function createPTYManager(): PTYManager {
  let currentPty: IPty | null = null;

  return {
    get current() {
      return currentPty;
    },

    spawn(config: PTYConfig): IPty {
      // Load node-pty lazily (throws if unavailable)
      const pty = loadNodePty();

      // Kill existing PTY if any
      if (currentPty) {
        try {
          currentPty.kill();
        } catch {
          // Ignore errors when killing
        }
      }

      // Filter out undefined values from process.env for node-pty stability
      const cleanEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (typeof v === "string") cleanEnv[k] = v;
      }

      const options: IPtyForkOptions = {
        name: "xterm-256color",
        cols: config.cols ?? 120,
        rows: config.rows ?? 30,
        cwd: config.cwd,
        env: cleanEnv,
      };

      // On Windows, conditionally use ConPTY
      if (process.platform === "win32") {
        options.useConpty = shouldUseConpty();
      }

      currentPty = pty.spawn(config.cmd, config.args, options);

      return currentPty;
    },

    kill() {
      if (currentPty) {
        try {
          currentPty.kill();
        } catch {
          // Ignore errors when killing
        }
        currentPty = null;
      }
    },

    write(data: string) {
      if (currentPty) {
        currentPty.write(data);
      }
    },
  };
}

/**
 * Create PTY config from a Profile
 */
export function configFromProfile(profile: Profile): PTYConfig {
  return {
    cmd: profile.cmd,
    args: profile.args,
    cwd: profile.cwd ?? process.cwd(),
  };
}

/**
 * Parse command arguments from environment variables
 * TARGET_ARGS_JSON (JSON array) takes precedence over TARGET_ARGS (space-separated)
 */
function parseArgs(env: Record<string, string | undefined>): string[] {
  if (env.TARGET_ARGS_JSON) {
    try {
      const raw = JSON.parse(env.TARGET_ARGS_JSON);
      if (!Array.isArray(raw) || !raw.every((x) => typeof x === "string")) {
        throw new Error("must be array of strings");
      }
      return raw;
    } catch {
      throw new Error(
        "Invalid TARGET_ARGS_JSON (must be JSON array of strings)"
      );
    }
  }

  if (env.TARGET_ARGS) {
    return env.TARGET_ARGS.split(" ").filter(Boolean);
  }

  return [];
}

/**
 * Create PTY config from environment variables
 */
export function configFromEnv(
  env: Record<string, string | undefined> = process.env
): PTYConfig {
  return {
    cmd: env.TARGET_CMD ?? getDefaultShell(),
    args: parseArgs(env),
    cwd: env.TARGET_CWD ?? process.cwd(),
  };
}
