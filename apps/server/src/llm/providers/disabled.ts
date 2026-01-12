import type { LLMAdapter } from "../adapter.js";

export const disabledAdapter: LLMAdapter = {
  name: "disabled",
  async generateText() {
    throw new Error(
      "LLM is disabled. Set LLM_PROVIDER env variable to enable.\n" +
      "Valid values: mock, openai, anthropic, gemini"
    );
  },
};
