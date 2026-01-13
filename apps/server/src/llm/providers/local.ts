import type { LLMAdapter } from "../adapter.js";
import { createOpenAICompatAdapter } from "./openai_compat.js";

const DEFAULT_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_MODEL = "llama3.2";

/**
 * Creates a Local LLM adapter for Ollama, vLLM, or any OpenAI-compatible local endpoint.
 *
 * Environment variables:
 * - LOCAL_BASE_URL (optional, defaults to http://localhost:11434/v1 for Ollama)
 * - LOCAL_MODEL (optional, defaults to llama3.2)
 * - LOCAL_API_KEY (optional, some local endpoints don't require auth)
 */
export function createLocalAdapter(
  env: Record<string, string | undefined> = process.env
): LLMAdapter {
  const baseURL = env.LOCAL_BASE_URL || DEFAULT_BASE_URL;
  const model = env.LOCAL_MODEL || DEFAULT_MODEL;
  const apiKey = env.LOCAL_API_KEY || "not-required";

  return createOpenAICompatAdapter({
    name: "local",
    baseURL,
    apiKey,
    model,
    defaultMaxTokens: 256,
    defaultTemperature: 0.7,
  });
}
