import type { LLMAdapter } from "../adapter.js";
import type { ChatMessage, GenerateTextRequest, GenerateTextResponse } from "../types.js";
import { CommentError } from "../../errors.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_MODEL = "claude-3-5-sonnet-20240620";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: Array<{ type: "text"; text: string }>;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  temperature?: number;
  system?: string;
  messages: AnthropicMessage[];
}

interface AnthropicResponse {
  model?: string;
  content?: Array<{ type?: string; text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
  };
}

/**
 * Creates an Anthropic LLM adapter using the Messages API.
 *
 * Environment variables:
 * - ANTHROPIC_API_KEY (required)
 * - ANTHROPIC_BASE_URL (optional, defaults to https://api.anthropic.com/v1)
 * - ANTHROPIC_MODEL (optional, defaults to claude-3-5-sonnet-20240620)
 */
export function createAnthropicAdapter(
  env: Record<string, string | undefined> = process.env
): LLMAdapter {
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for Anthropic provider");
  }

  const baseURL = env.ANTHROPIC_BASE_URL || DEFAULT_BASE_URL;
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  return {
    name: "anthropic",
    async generateText(req: GenerateTextRequest): Promise<GenerateTextResponse> {
      // 1. Check if already aborted
      if (req.signal?.aborted) {
        throw new CommentError("comment_aborted");
      }

      const endpoint = `${baseURL.replace(/\/$/, "")}/messages`;

      const systemPrompt = req.messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n");

      const messages: AnthropicMessage[] = req.messages
        .filter((m): m is ChatMessage & { role: "user" | "assistant" } => m.role !== "system")
        .map((m) => ({
          role: m.role,
          content: [{ type: "text" as const, text: m.content }],
        }));

      const body: AnthropicRequest = {
        model: req.model || model,
        max_tokens: req.maxTokens ?? 256,
        temperature: req.temperature ?? 0.7,
        messages,
      };

      if (systemPrompt) {
        body.system = systemPrompt;
      }

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
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

      let data: AnthropicResponse;
      try {
        data = (await response.json()) as AnthropicResponse;
      } catch {
        if (!response.ok) {
          throw new CommentError("comment_llm_error", `HTTP ${response.status}`);
        }
        throw new CommentError("comment_llm_error", "Invalid JSON response");
      }

      if (!response.ok) {
        const errorMessage = data.error?.message || `HTTP ${response.status}`;
        throw new CommentError("comment_llm_error", errorMessage);
      }

      if (data.error?.message) {
        throw new CommentError("comment_llm_error", data.error.message);
      }

      const text = (data.content ?? [])
        .filter((block) => block?.type === "text")
        .map((block) => block.text ?? "")
        .join("");

      if (!text) {
        throw new CommentError("comment_llm_error", "Empty response from LLM");
      }

      return {
        text,
        model: data.model ?? body.model,
        usage: data.usage
          ? {
              inputTokens: data.usage.input_tokens,
              outputTokens: data.usage.output_tokens,
            }
          : undefined,
        raw: data,
      };
    },
  };
}
