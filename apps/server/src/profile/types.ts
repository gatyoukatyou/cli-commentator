import type { Style, SourceMode, InputMode } from "../types.js";
import type { ProviderName } from "../llm/types.js";

export type ProfileLLMProviders = {
  llmProvider?: ProviderName;
  narrationProvider?: ProviderName;
  explanationProvider?: ProviderName;
};

/**
 * Full profile definition with all settings
 */
export type Profile = ProfileLLMProviders & {
  id: string;
  name: string;
  cmd: string;
  args: string[];
  cwd?: string;
  style: Style;
  logSource: SourceMode;
  inputMode?: InputMode;
  inputFile?: string;
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
export type CreateProfileInput = ProfileLLMProviders & {
  name: string;
  cmd: string;
  args?: string[];
  cwd?: string;
  style?: Style;
  logSource?: SourceMode;
  inputMode?: InputMode;
  inputFile?: string;
};

/**
 * Input for updating an existing profile
 */
export type UpdateProfileInput = Partial<CreateProfileInput>;
