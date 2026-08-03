export type Style = "standard" | "kansai" | "zundamon";
export type DetectedSource = "claude" | "codex" | "generic";
export type SourceMode = "auto" | DetectedSource;
export type InputMode = "pty" | "file";
export type SourceState = { mode: SourceMode; detected: DetectedSource | null };

export type EventType =
  | "start"
  | "stdout"
  | "stderr"
  | "read"
  | "write"
  | "search"
  | "test"
  | "git"
  | "github"
  | "install"
  | "build"
  | "lint"
  | "server"
  | "error"
  | "done";

export type EventPriority = "urgent" | "notice" | "progress";

export type Event = {
  ts: number;
  type: EventType;
  summary: string;
  detail?: string;
  priority?: EventPriority;
};

export type CommentaryMode = "narration" | "explanation" | "both";

export type CommentarySpeechDisposition = "speak" | "display_only";

export type CommentarySpeechReason =
  | "urgent"
  | "human_required"
  | "completion"
  | "failure"
  | "success"
  | "new_task"
  | "phase_change"
  | "new_target"
  | "progress_refresh"
  | "progress_interval"
  | "not_significant";

export type CommentarySpeech = {
  disposition: CommentarySpeechDisposition;
  reason: CommentarySpeechReason;
  text?: string;
};

export type CommentaryMeta = {
  narrationProvider?: string;
  explanationProvider?: string;
  mode?: CommentaryMode;
};

export type CommentaryPayload = {
  narration?: string;
  explanation?: string;
  glossaryNotes?: string[];
  speech?: CommentarySpeech;
  meta?: CommentaryMeta;
};

export type ProviderName =
  | "disabled"
  | "mock"
  | "openai"
  | "deepseek"
  | "groq"
  | "local"
  | "anthropic"
  | "gemini";

export type ProfileLLMProviders = {
  llmProvider?: ProviderName;
  narrationProvider?: ProviderName;
  explanationProvider?: ProviderName;
};

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

export type ProfileSummary = Pick<Profile, "id" | "name" | "cmd">;

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

export type UpdateProfileInput = Partial<CreateProfileInput>;

export type LaunchSessionInput = {
  name?: string;
  cmd: string;
  args?: string[];
  cwd?: string;
  style?: Style;
  logSource?: SourceMode;
};

export type WsOutgoing =
  | { kind: "hello"; style: Style; source: SourceState }
  | { kind: "style"; style: Style }
  | { kind: "source"; source: SourceState }
  | { kind: "raw"; data: string }
  | { kind: "event"; ev: Event }
  | ({ kind: "commentary"; ts: number; ev: Event } & CommentaryPayload)
  | { kind: "profiles"; profiles: ProfileSummary[]; activeId: string | null }
  | { kind: "profileSaved"; profile: ProfileSummary; activeId: string | null }
  | { kind: "profileDeleted"; id: string; activeId: string | null }
  | { kind: "profileDetail"; profile: Profile }
  | { kind: "profileError"; error: string }
  | { kind: "ptyRestart"; cmd: string; args: string[]; profileId: string | null }
  | { kind: "ptyError"; error: string }
  | { kind: "ptyUnavailable"; error: string; suggestion: string };

export type WsIncoming =
  | { kind: "setStyle"; style: Style }
  | { kind: "launchSession"; session: LaunchSessionInput }
  | { kind: "writeInput"; data: string }
  | { kind: "getProfiles" }
  | { kind: "getProfile"; id: string }
  | { kind: "saveProfile"; profile: CreateProfileInput & { id?: string } }
  | { kind: "deleteProfile"; id: string }
  | { kind: "setActiveProfile"; id: string | null };
