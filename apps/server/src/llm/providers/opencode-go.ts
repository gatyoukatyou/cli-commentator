import type { LLMAdapter } from "../adapter.js";
import { createOpenAICompatAdapter } from "./openai_compat.js";

export const DEFAULT_OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
export const DEFAULT_OPENCODE_GO_MODEL = "deepseek-v4-flash";

/**
 * Creates an OpenCode Go LLM adapter for chat/completions models.
 *
 * Environment variables:
 * - OPENCODE_GO_API_KEY (required)
 * - OPENCODE_GO_MODEL (optional, defaults to deepseek-v4-flash)
 */
export function createOpenCodeGoAdapter(
  env: Record<string, string | undefined> = process.env
): LLMAdapter {
  const apiKey = env.OPENCODE_GO_API_KEY;

  if (!apiKey) {
    throw new Error("OPENCODE_GO_API_KEY is required for OpenCode Go provider");
  }

  return createOpenAICompatAdapter({
    name: "opencode-go",
    baseURL: DEFAULT_OPENCODE_GO_BASE_URL,
    apiKey,
    model: env.OPENCODE_GO_MODEL || DEFAULT_OPENCODE_GO_MODEL,
    defaultMaxTokens: 256,
    defaultTemperature: 0.7,
  });
}
