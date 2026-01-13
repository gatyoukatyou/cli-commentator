import type { LLMAdapter } from "../adapter.js";
import { createOpenAICompatAdapter } from "./openai_compat.js";

const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

/**
 * Creates a Groq LLM adapter.
 *
 * Environment variables:
 * - GROQ_API_KEY (required)
 * - GROQ_BASE_URL (optional, defaults to https://api.groq.com/openai/v1)
 * - GROQ_MODEL (optional, defaults to llama-3.3-70b-versatile)
 */
export function createGroqAdapter(
  env: Record<string, string | undefined> = process.env
): LLMAdapter {
  const apiKey = env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is required for Groq provider");
  }

  return createOpenAICompatAdapter({
    name: "groq",
    baseURL: env.GROQ_BASE_URL || DEFAULT_BASE_URL,
    apiKey,
    model: env.GROQ_MODEL || DEFAULT_MODEL,
    defaultMaxTokens: 256,
    defaultTemperature: 0.7,
  });
}
