import type { LLMAdapter } from "../adapter.js";
import { createOpenAICompatAdapter } from "./openai_compat.js";

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

/**
 * Creates a DeepSeek LLM adapter.
 *
 * Environment variables:
 * - DEEPSEEK_API_KEY (required)
 * - DEEPSEEK_BASE_URL (optional, defaults to https://api.deepseek.com)
 * - DEEPSEEK_MODEL (optional, defaults to deepseek-v4-flash)
 */
export function createDeepSeekAdapter(
  env: Record<string, string | undefined> = process.env
): LLMAdapter {
  const apiKey = env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is required for DeepSeek provider");
  }

  return createOpenAICompatAdapter({
    name: "deepseek",
    baseURL: env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL,
    apiKey,
    model: env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
    defaultMaxTokens: 256,
    defaultTemperature: 0.7,
  });
}
