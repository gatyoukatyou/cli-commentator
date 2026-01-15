import * as pty from "node-pty";
import type { IPty } from "node-pty";
import type { Profile } from "../profile/types.js";

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
      // Kill existing PTY if any
      if (currentPty) {
        try {
          currentPty.kill();
        } catch {
          // Ignore errors when killing
        }
      }

      currentPty = pty.spawn(config.cmd, config.args, {
        name: "xterm-256color",
        cols: config.cols ?? 120,
        rows: config.rows ?? 30,
        cwd: config.cwd,
        env: process.env as Record<string, string>,
      });

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
 * Create PTY config from environment variables
 */
export function configFromEnv(
  env: Record<string, string | undefined> = process.env
): PTYConfig {
  return {
    cmd: env.TARGET_CMD ?? "bash",
    args: env.TARGET_ARGS ? env.TARGET_ARGS.split(" ").filter(Boolean) : [],
    cwd: env.TARGET_CWD ?? process.cwd(),
  };
}
