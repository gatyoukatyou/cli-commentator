import type { Style, SourceMode, InputMode } from "../types.js";
import type { ProviderName } from "../llm/types.js";

/**
 * Full profile definition with all settings
 */
export type Profile = {
  id: string;
  name: string;
  cmd: string;
  args: string[];
  cwd?: string;
  style: Style;
  logSource: SourceMode;
  inputMode?: InputMode;
  inputFile?: string;
  llmProvider?: ProviderName;
  createdAt: number;
  updatedAt: number;
};

/**
 * Minimal profile info for list display
 */
export type ProfileSummary = Pick<Profile, "id" | "name" | "cmd">;

/**
 * Persisted store format
 */
export type ProfileStore = {
  version: 1;
  activeId: string | null;
  profiles: Profile[];
};

/**
 * Input for creating a new profile (id/timestamps auto-generated)
 */
export type CreateProfileInput = {
  name: string;
  cmd: string;
  args?: string[];
  cwd?: string;
  style?: Style;
  logSource?: SourceMode;
  inputMode?: InputMode;
  inputFile?: string;
  llmProvider?: ProviderName;
};

/**
 * Input for updating an existing profile
 */
export type UpdateProfileInput = Partial<CreateProfileInput>;
