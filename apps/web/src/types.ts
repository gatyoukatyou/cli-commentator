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

export type PtyUnavailablePayload = {
  error?: string;
  suggestion?: string;
};

export type ServerToClientMessage =
  | { kind: "hello"; style: Style; source: SourceState }
  | { kind: "style"; style: Style }
  | { kind: "source"; source: SourceState }
  | { kind: "commentary"; ts: number; text: string }
  | { kind: "profiles"; profiles: ProfileSummary[]; activeId: string | null }
  | { kind: "profileSaved"; profile: ProfileSummary; activeId: string | null }
  | { kind: "profileDeleted"; id: string; activeId: string | null }
  | { kind: "profileDetail"; profile: Profile }
  | { kind: "profileError"; error: string }
  | { kind: "ptyRestart"; cmd: string; args: string[]; profileId: string | null }
  | { kind: "ptyError"; error: string }
  | { kind: "ptyUnavailable"; error?: string; suggestion?: string };
