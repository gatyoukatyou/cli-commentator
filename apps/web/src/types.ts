export type Style = "standard" | "kansai" | "zundamon";
export type DetectedSource = "claude" | "codex" | "generic";
export type SourceMode = "auto" | DetectedSource;
export type SourceState = { mode: SourceMode; detected: DetectedSource | null };

export type ProviderName = "disabled" | "mock" | "openai" | "groq" | "local" | "anthropic" | "gemini";

export type Profile = {
  id: string;
  name: string;
  cmd: string;
  args: string[];
  cwd?: string;
  style: Style;
  logSource: SourceMode;
  llmProvider?: ProviderName;
  createdAt: number;
  updatedAt: number;
};

export type ProfileSummary = Pick<Profile, "id" | "name" | "cmd">;

export type CreateProfileInput = {
  name: string;
  cmd: string;
  args?: string[];
  cwd?: string;
  style?: Style;
  logSource?: SourceMode;
  llmProvider?: ProviderName;
};
