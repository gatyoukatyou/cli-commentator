import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { ProfileStore } from "./types.js";

const CONFIG_DIR_NAME = "cli-commentator";
const STORE_FILE_NAME = "profiles.json";

/**
 * Options for getConfigDir (mainly for testing)
 */
export type GetConfigDirOptions = {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
};

/**
 * Get the config directory path
 * - XDG_CONFIG_HOME (explicit override, honored on all platforms for testing)
 * - Windows: APPDATA > USERPROFILE\AppData\Roaming > os.homedir()
 * - Unix: ~/.config
 */
export function getConfigDir(options?: GetConfigDirOptions): string {
  const platform = options?.platform ?? process.platform;
  const env = options?.env ?? process.env;

  // XDG_CONFIG_HOME is an explicit override (honor on all platforms)
  const xdgConfigHome = env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, CONFIG_DIR_NAME);
  }

  // Windows: APPDATA > USERPROFILE\AppData\Roaming > os.homedir()
  if (platform === "win32") {
    const appData =
      env.APPDATA ??
      (env.USERPROFILE
        ? path.win32.join(env.USERPROFILE, "AppData", "Roaming")
        : path.win32.join(os.homedir(), "AppData", "Roaming"));
    return path.win32.join(appData, CONFIG_DIR_NAME);
  }

  // Unix: ~/.config
  const home = env.HOME ?? os.homedir();
  return path.posix.join(home, ".config", CONFIG_DIR_NAME);
}

/**
 * Get the full path to profiles.json
 */
export function getStorePath(): string {
  return path.join(getConfigDir(), STORE_FILE_NAME);
}

/**
 * Ensure the config directory exists
 */
export async function ensureDir(): Promise<void> {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Create an empty store with default values
 */
function createEmptyStore(): ProfileStore {
  return {
    version: 1,
    activeId: null,
    profiles: [],
  };
}

/**
 * Load the profile store from disk
 * Returns an empty store if the file doesn't exist or is corrupted
 */
export async function loadStore(): Promise<ProfileStore> {
  const path = getStorePath();

  if (!existsSync(path)) {
    return createEmptyStore();
  }

  try {
    const content = await readFile(path, "utf-8");
    const data = JSON.parse(content) as ProfileStore;

    // Basic validation
    if (
      typeof data !== "object" ||
      data === null ||
      data.version !== 1 ||
      !Array.isArray(data.profiles)
    ) {
      console.warn("[profile/store] Invalid store format, returning empty store");
      return createEmptyStore();
    }

    return data;
  } catch (err) {
    console.warn("[profile/store] Failed to load store, returning empty store:", err);
    return createEmptyStore();
  }
}

/**
 * Save the profile store to disk using atomic write
 * Writes to a temp file first, then renames to prevent corruption
 */
export async function saveStore(store: ProfileStore): Promise<void> {
  await ensureDir();

  const path = getStorePath();
  const tempPath = `${path}.${randomUUID()}.tmp`;

  try {
    const content = JSON.stringify(store, null, 2);
    await writeFile(tempPath, content, "utf-8");
    await rename(tempPath, path);
  } catch (err) {
    // Clean up temp file if rename failed
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}
