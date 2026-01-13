export type ProviderName = "disabled" | "mock" | "openai" | "groq" | "local" | "anthropic" | "gemini";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GenerateTextRequest = {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type GenerateTextResponse = {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  raw?: unknown;
};
