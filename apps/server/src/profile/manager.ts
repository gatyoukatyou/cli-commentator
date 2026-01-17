import { randomUUID } from "node:crypto";
import { loadStore, saveStore } from "./store.js";
import type {
  Profile,
  ProfileSummary,
  ProfileStore,
  CreateProfileInput,
  UpdateProfileInput,
} from "./types.js";
import type { Style, SourceMode } from "../types.js";
import type { ProviderName } from "../llm/types.js";

// In-memory cache to avoid repeated disk reads
let cachedStore: ProfileStore | null = null;

/**
 * Get the current store (with caching)
 */
async function getStore(): Promise<ProfileStore> {
  if (!cachedStore) {
    cachedStore = await loadStore();
  }
  return cachedStore;
}

/**
 * Save and update cache
 */
async function persistStore(store: ProfileStore): Promise<void> {
  await saveStore(store);
  cachedStore = store;
}

/**
 * Convert a full Profile to ProfileSummary
 */
function toSummary(profile: Profile): ProfileSummary {
  return {
    id: profile.id,
    name: profile.name,
    cmd: profile.cmd,
  };
}

/**
 * List all profiles as summaries
 */
export async function list(): Promise<ProfileSummary[]> {
  const store = await getStore();
  return store.profiles.map(toSummary);
}

/**
 * Get a profile by ID
 */
export async function get(id: string): Promise<Profile | null> {
  const store = await getStore();
  return store.profiles.find((p) => p.id === id) ?? null;
}

/**
 * Get the currently active profile ID
 */
export async function getActiveId(): Promise<string | null> {
  const store = await getStore();
  return store.activeId;
}

/**
 * Get the currently active profile
 */
export async function getActive(): Promise<Profile | null> {
  const store = await getStore();
  if (!store.activeId) return null;
  return store.profiles.find((p) => p.id === store.activeId) ?? null;
}

/**
 * Set the active profile ID
 */
export async function setActive(id: string | null): Promise<void> {
  const store = await getStore();

  // If setting to a specific ID, verify it exists
  if (id !== null) {
    const exists = store.profiles.some((p) => p.id === id);
    if (!exists) {
      throw new Error(`Profile not found: ${id}`);
    }
  }

  await persistStore({
    ...store,
    activeId: id,
  });
}

/**
 * Create a new profile
 */
export async function create(input: CreateProfileInput): Promise<Profile> {
  const store = await getStore();
  const now = Date.now();

  const profile: Profile = {
    id: randomUUID(),
    name: input.name,
    cmd: input.cmd,
    args: input.args ?? [],
    cwd: input.cwd,
    style: input.style ?? "kansai",
    logSource: input.logSource ?? "auto",
    llmProvider: input.llmProvider,
    createdAt: now,
    updatedAt: now,
  };

  await persistStore({
    ...store,
    profiles: [...store.profiles, profile],
  });

  return profile;
}

/**
 * Update an existing profile
 */
export async function update(
  id: string,
  input: UpdateProfileInput
): Promise<Profile> {
  const store = await getStore();
  const index = store.profiles.findIndex((p) => p.id === id);

  if (index === -1) {
    throw new Error(`Profile not found: ${id}`);
  }

  const existing = store.profiles[index];
  const updated: Profile = {
    ...existing,
    ...(input.name !== undefined && { name: input.name }),
    ...(input.cmd !== undefined && { cmd: input.cmd }),
    ...(input.args !== undefined && { args: input.args }),
    ...(input.cwd !== undefined && { cwd: input.cwd }),
    ...(input.style !== undefined && { style: input.style }),
    ...(input.logSource !== undefined && { logSource: input.logSource }),
    ...(input.llmProvider !== undefined && { llmProvider: input.llmProvider }),
    updatedAt: Date.now(),
  };

  const profiles = [...store.profiles];
  profiles[index] = updated;

  await persistStore({
    ...store,
    profiles,
  });

  return updated;
}

/**
 * Delete a profile by ID
 * If the deleted profile was active, activeId is cleared
 */
export async function remove(id: string): Promise<void> {
  const store = await getStore();
  const exists = store.profiles.some((p) => p.id === id);

  if (!exists) {
    throw new Error(`Profile not found: ${id}`);
  }

  const profiles = store.profiles.filter((p) => p.id !== id);
  const activeId = store.activeId === id ? null : store.activeId;

  await persistStore({
    ...store,
    profiles,
    activeId,
  });
}

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
 * Create a profile input from current environment variables
 * Useful for backwards compatibility / initial profile creation
 */
export function createFromEnv(
  env: Record<string, string | undefined> = process.env
): CreateProfileInput {
  const cmd = env.TARGET_CMD ?? getDefaultShell();
  const args = parseArgs(env);
  const cwd = env.TARGET_CWD;

  const style = (env.STYLE as Style | undefined) ?? "kansai";
  const logSource = (env.LOG_SOURCE as SourceMode | undefined) ?? "auto";
  const llmProvider = (env.LLM_PROVIDER as ProviderName | undefined) ?? undefined;

  return {
    name: "Default",
    cmd,
    args,
    cwd,
    style,
    logSource,
    llmProvider,
  };
}

/**
 * Clear the in-memory cache (useful for testing)
 */
export function clearCache(): void {
  cachedStore = null;
}
