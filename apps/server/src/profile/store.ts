import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ProfileStore } from "./types.js";

const CONFIG_DIR_NAME = "cli-commentator";
const STORE_FILE_NAME = "profiles.json";

/**
 * Get the config directory path respecting XDG_CONFIG_HOME
 */
export function getConfigDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const home = process.env.HOME ?? "";

  if (xdgConfigHome) {
    return join(xdgConfigHome, CONFIG_DIR_NAME);
  }

  return join(home, ".config", CONFIG_DIR_NAME);
}

/**
 * Get the full path to profiles.json
 */
export function getStorePath(): string {
  return join(getConfigDir(), STORE_FILE_NAME);
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
