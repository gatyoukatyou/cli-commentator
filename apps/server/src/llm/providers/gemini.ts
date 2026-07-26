import type { LLMAdapter } from "../adapter.js";
import type { GenerateTextRequest, GenerateTextResponse } from "../types.js";
import { CommentError } from "../../errors.js";

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    thinkingConfig?: {
      thinkingBudget: number;
    };
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: {
    message?: string;
    code?: number;
  };
}

/**
 * Creates a Gemini LLM adapter using the REST API.
 *
 * Environment variables:
 * - GOOGLE_API_KEY (required)
 * - GEMINI_MODEL (optional, defaults to gemini-3.5-flash)
 */
export function createGeminiAdapter(
  env: Record<string, string | undefined> = process.env
): LLMAdapter {
  const apiKey = env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is required for Gemini provider");
  }

  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

  return {
    name: "gemini",
    async generateText(req: GenerateTextRequest): Promise<GenerateTextResponse> {
      // 1. Check if already aborted
      if (req.signal?.aborted) {
        throw new CommentError("comment_aborted");
      }

      const endpoint = `${API_BASE}/${model}:generateContent`;

      // Convert OpenAI-style messages to Gemini format
      const contents: GeminiContent[] = req.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const body: GeminiRequest = {
        contents,
        generationConfig: {
          temperature: req.temperature ?? 0.7,
          maxOutputTokens: req.maxTokens ?? 256,
          ...(supportsZeroThinkingBudget(model)
            ? { thinkingConfig: { thinkingBudget: 0 } }
            : {}),
        },
      };

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
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

      // Parse response
      let data: GeminiResponse;
      try {
        data = (await response.json()) as GeminiResponse;
      } catch {
        throw new CommentError("comment_llm_error", "Invalid JSON response");
      }

      // Handle API error
      if (data.error) {
        throw new CommentError(
          "comment_llm_error",
          data.error.message || `API error code: ${data.error.code}`
        );
      }

      // Handle non-2xx responses (backup in case error field wasn't present)
      if (!response.ok) {
        throw new CommentError("comment_llm_error", `HTTP ${response.status}`);
      }

      // Extract text from response
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new CommentError("comment_llm_error", "Empty response from LLM");
      }

      return {
        text,
        usage: data.usageMetadata
          ? {
              inputTokens: data.usageMetadata.promptTokenCount,
              outputTokens: data.usageMetadata.candidatesTokenCount,
            }
          : undefined,
        raw: data,
      };
    },
  };
}

function supportsZeroThinkingBudget(model: string): boolean {
  return /^gemini-(?:2\.5-(?:flash|flash-lite)|3\.5-(?:flash|flash-lite))(?:$|-)/u.test(
    model
  );
}
