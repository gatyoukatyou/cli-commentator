import type { LLMAdapter } from "../adapter.js";
import type { GenerateTextRequest, GenerateTextResponse, ProviderName } from "../types.js";
import { CommentError } from "../../errors.js";

export interface OpenAICompatConfig {
  name: ProviderName;
  baseURL: string;
  apiKey: string;
  model: string;
  defaultMaxTokens?: number;
  defaultTemperature?: number;
}

interface OpenAIChatCompletionResponse {
  id: string;
  object: string;
  model?: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

/**
 * Creates an LLMAdapter for OpenAI-compatible APIs.
 * Works with OpenAI, Groq, Ollama, vLLM, and other compatible endpoints.
 */
export function createOpenAICompatAdapter(config: OpenAICompatConfig): LLMAdapter {
  const {
    name,
    baseURL,
    apiKey,
    model,
    defaultMaxTokens = 256,
    defaultTemperature = 0.7,
  } = config;

  return {
    name,
    async generateText(req: GenerateTextRequest): Promise<GenerateTextResponse> {
      // 1. Check if already aborted
      if (req.signal?.aborted) {
        throw new CommentError("comment_aborted");
      }

      const endpoint = `${baseURL.replace(/\/$/, "")}/chat/completions`;

      const actualModel = req.model ?? model;
      const body = {
        model: actualModel,
        messages: req.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        max_tokens: req.maxTokens ?? defaultMaxTokens,
        temperature: req.temperature ?? defaultTemperature,
      };

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: req.signal,
        });
      } catch (err) {
        // AbortError from fetch
        if (err instanceof Error && err.name === "AbortError") {
          throw new CommentError("comment_aborted");
        }
        // Network error
        throw new CommentError(
          "comment_llm_error",
          `Network error: ${err instanceof Error ? err.message : "unknown"}`
        );
      }

      // Handle non-2xx responses
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorData = (await response.json()) as OpenAIErrorResponse;
          if (errorData.error?.message) {
            errorMessage = errorData.error.message;
          }
        } catch {
          // Ignore JSON parse errors
        }
        throw new CommentError("comment_llm_error", errorMessage);
      }

      // Parse successful response
      let data: OpenAIChatCompletionResponse;
      try {
        data = (await response.json()) as OpenAIChatCompletionResponse;
      } catch {
        throw new CommentError("comment_llm_error", "Invalid JSON response");
      }

      const text = data.choices?.[0]?.message?.content;
      if (!text) {
        throw new CommentError("comment_llm_error", "Empty response from LLM");
      }

      return {
        text,
        model: data.model ?? actualModel,
        usage: data.usage
          ? {
              inputTokens: data.usage.prompt_tokens,
              outputTokens: data.usage.completion_tokens,
            }
          : undefined,
        raw: data,
      };
    },
  };
}
