import type { LLMAdapter } from "./adapter.js";
import { disabledAdapter } from "./providers/disabled.js";
import { mockAdapter } from "./providers/mock.js";
import { createOpenAIAdapter } from "./providers/openai.js";
import { createGroqAdapter } from "./providers/groq.js";

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

  // 将来の実装: local, anthropic, gemini
  if (provider === "local" || provider === "anthropic" || provider === "gemini") {
    throw new Error(`LLM provider "${provider}" is not yet implemented.`);
  }

  throw new Error(
    `Invalid LLM_PROVIDER: "${provider}". ` +
    `Valid values: ${VALID_PROVIDERS.join(", ")}`
  );
}
