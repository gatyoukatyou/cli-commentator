import type { LLMAdapter } from "./adapter.js";
import { disabledAdapter } from "./providers/disabled.js";
import { mockAdapter } from "./providers/mock.js";
import { createOpenAIAdapter } from "./providers/openai.js";
import { createGroqAdapter } from "./providers/groq.js";
import { createLocalAdapter } from "./providers/local.js";
import { createGeminiAdapter } from "./providers/gemini.js";

const VALID_PROVIDERS = ["disabled", "mock", "openai", "groq", "local", "anthropic", "gemini"] as const;

export function createLLMAdapter(env: Record<string, string | undefined> = process.env): LLMAdapter {
  const provider = env.LLM_PROVIDER?.toLowerCase() ?? "";

  if (!provider || provider === "disabled") {
    return disabledAdapter;
  }

  if (provider === "mock") {
    return mockAdapter;
  }

  if (provider === "openai") {
    return createOpenAIAdapter(env);
  }

  if (provider === "groq") {
    return createGroqAdapter(env);
  }

  if (provider === "local") {
    return createLocalAdapter(env);
  }

  if (provider === "gemini") {
    return createGeminiAdapter(env);
  }

  // 将来の実装: anthropic
  if (provider === "anthropic") {
    throw new Error(`LLM provider "${provider}" is not yet implemented.`);
  }

  throw new Error(
    `Invalid LLM_PROVIDER: "${provider}". ` +
    `Valid values: ${VALID_PROVIDERS.join(", ")}`
  );
}
