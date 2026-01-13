import type { LLMAdapter } from "../adapter.js";
import { createOpenAICompatAdapter } from "./openai_compat.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * Creates an OpenAI LLM adapter.
 *
 * Environment variables:
 * - OPENAI_API_KEY (required)
 * - OPENAI_BASE_URL (optional, defaults to https://api.openai.com/v1)
 * - OPENAI_MODEL (optional, defaults to gpt-4o-mini)
 */
export function createOpenAIAdapter(
  env: Record<string, string | undefined> = process.env
): LLMAdapter {
  const apiKey = env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for OpenAI provider");
  }

  return createOpenAICompatAdapter({
    name: "openai",
    baseURL: env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
    apiKey,
    model: env.OPENAI_MODEL || DEFAULT_MODEL,
    defaultMaxTokens: 256,
    defaultTemperature: 0.7,
  });
}
