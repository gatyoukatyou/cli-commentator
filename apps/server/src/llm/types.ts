export type { ProviderName } from "@cli-commentator/shared";

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
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  raw?: unknown;
};
