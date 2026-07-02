import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadStore, saveStore } from "./store.js";
import type {
  Profile,
  ProfileSummary,
  ProfileStore,
  CreateProfileInput,
  UpdateProfileInput,
} from "./types.js";
import type { Style, SourceMode, InputMode } from "../types.js";
import type { ProviderName } from "../llm/types.js";
import {
  getDefaultShell,
  normalizeArgs as normalizeSharedArgs,
  normalizeInputMode,
  normalizeOptionalArgs,
  normalizeOptionalProvider,
  normalizeOptionalString,
  normalizeString,
  parseInputModeFromEnv,
  parseTargetArgs,
} from "../shared/validation.js";

// In-memory cache to avoid repeated disk reads
let cachedStore: ProfileStore | null = null;

function normalizeCommand(value: string, inputMode?: InputMode): string {
  const trimmed = value.trim();
  if (trimmed) return trimmed;
  return inputMode === "file" ? "file" : trimmed;
}

function normalizeCreateInput(input: CreateProfileInput): CreateProfileInput {
  const inputMode = normalizeInputMode(input.inputMode) ?? "pty";
  return {
    ...input,
    name: normalizeString(input.name),
    cmd: normalizeCommand(input.cmd, inputMode),
    args: normalizeOptionalArgs(input.args),
    cwd: normalizeOptionalString(input.cwd),
    inputMode,
    inputFile: normalizeOptionalString(input.inputFile),
    llmProvider: normalizeOptionalProvider(input.llmProvider),
    narrationProvider: normalizeOptionalProvider(input.narrationProvider),
    explanationProvider: normalizeOptionalProvider(input.explanationProvider),
  };
}

function normalizeUpdateInput(input: UpdateProfileInput): UpdateProfileInput {
  const inputMode = normalizeInputMode(input.inputMode);
  return {
    ...input,
    ...(input.name !== undefined && { name: normalizeString(input.name) }),
    ...(input.cmd !== undefined && { cmd: normalizeCommand(input.cmd, inputMode) }),
    ...(input.args !== undefined && { args: normalizeOptionalArgs(input.args) }),
    ...(input.cwd !== undefined && { cwd: normalizeOptionalString(input.cwd) }),
    ...(input.inputMode !== undefined && { inputMode }),
    ...(input.inputFile !== undefined && { inputFile: normalizeOptionalString(input.inputFile) }),
    ...(input.llmProvider !== undefined && { llmProvider: normalizeOptionalProvider(input.llmProvider) }),
    ...(input.narrationProvider !== undefined && {
      narrationProvider: normalizeOptionalProvider(input.narrationProvider),
    }),
    ...(input.explanationProvider !== undefined && {
      explanationProvider: normalizeOptionalProvider(input.explanationProvider),
    }),
  };
}

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function displayCommand(profile: Profile): string {
  if (profile.inputMode === "file") {
    const base = profile.inputFile ? path.basename(profile.inputFile) : "log";
    return `file:${base}`;
  }
  return profile.cmd;
}

function hydrateProfile(profile: Profile): Profile {
  return {
    ...profile,
    inputMode: profile.inputMode ?? "pty",
    inputFile: normalizeOptionalString(profile.inputFile),
    llmProvider: normalizeOptionalProvider(profile.llmProvider),
    narrationProvider: normalizeOptionalProvider(profile.narrationProvider),
    explanationProvider: normalizeOptionalProvider(profile.explanationProvider),
  };
}

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
  const hydrated = hydrateProfile(profile);
  return {
    id: hydrated.id,
    name: hydrated.name,
    cmd: displayCommand(hydrated),
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
  const profile = store.profiles.find((p) => p.id === id) ?? null;
  return profile ? hydrateProfile(profile) : null;
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
  const profile = store.profiles.find((p) => p.id === store.activeId) ?? null;
  return profile ? hydrateProfile(profile) : null;
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
  const normalized = normalizeCreateInput(input);
  const store = await getStore();
  const now = Date.now();

  if (normalized.inputMode === "file" && !normalized.inputFile) {
    throw new Error("inputFile is required when inputMode=file");
  }

  const profile: Profile = {
    id: randomUUID(),
    name: normalized.name,
    cmd: normalized.cmd,
    args: normalized.args ?? [],
    cwd: normalized.cwd,
    style: normalized.style ?? "kansai",
    logSource: normalized.logSource ?? "auto",
    inputMode: normalized.inputMode ?? "pty",
    inputFile: normalized.inputFile,
    llmProvider: normalized.llmProvider,
    narrationProvider: normalized.narrationProvider,
    explanationProvider: normalized.explanationProvider,
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
  const normalized = normalizeUpdateInput(input);
  const store = await getStore();
  const index = store.profiles.findIndex((p) => p.id === id);

  if (index === -1) {
    throw new Error(`Profile not found: ${id}`);
  }

  const existing = store.profiles[index];
  const nextInputMode = normalized.inputMode ?? existing.inputMode ?? "pty";
  const nextInputFile =
    normalized.inputFile !== undefined ? normalized.inputFile : existing.inputFile;

  if (nextInputMode === "file" && !nextInputFile) {
    throw new Error("inputFile is required when inputMode=file");
  }

  const updated: Profile = {
    ...existing,
    ...(normalized.name !== undefined && { name: normalized.name }),
    ...(normalized.cmd !== undefined && { cmd: normalized.cmd }),
    ...(normalized.args !== undefined && { args: normalized.args }),
    ...(normalized.cwd !== undefined && { cwd: normalized.cwd }),
    ...(normalized.style !== undefined && { style: normalized.style }),
    ...(normalized.logSource !== undefined && { logSource: normalized.logSource }),
    ...(normalized.inputMode !== undefined && { inputMode: normalized.inputMode }),
    ...(normalized.inputFile !== undefined && { inputFile: normalized.inputFile }),
    ...(hasOwn(normalized, "llmProvider") && { llmProvider: normalized.llmProvider }),
    ...(hasOwn(normalized, "narrationProvider") && {
      narrationProvider: normalized.narrationProvider,
    }),
    ...(hasOwn(normalized, "explanationProvider") && {
      explanationProvider: normalized.explanationProvider,
    }),
    updatedAt: Date.now(),
  };

  const profiles = [...store.profiles];
  profiles[index] = updated;

  await persistStore({
    ...store,
    profiles,
  });

  return hydrateProfile(updated);
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
 * Create a profile input from current environment variables
 * Useful for backwards compatibility / initial profile creation
 */
export function createFromEnv(
  env: Record<string, string | undefined> = process.env
): CreateProfileInput {
  const inputMode = parseInputModeFromEnv(env);
  const cmd = normalizeString(env.TARGET_CMD ?? getDefaultShell());
  const args = normalizeSharedArgs(parseTargetArgs(env));
  const cwd = normalizeOptionalString(env.TARGET_CWD);
  const inputFile = normalizeOptionalString(env.INPUT_FILE);

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
    inputMode,
    inputFile,
    llmProvider,
    narrationProvider: undefined,
    explanationProvider: undefined,
  };
}

/**
 * Clear the in-memory cache (useful for testing)
 */
export function clearCache(): void {
  cachedStore = null;
}
