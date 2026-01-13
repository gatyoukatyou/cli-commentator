import { createHash } from "node:crypto";
import type { LLMAdapter } from "../adapter.js";
import type { GenerateTextRequest, GenerateTextResponse } from "../types.js";

function hashMessages(messages: GenerateTextRequest["messages"]): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(messages));
  return hash.digest("hex").slice(0, 8);
}

export const mockAdapter: LLMAdapter = {
  name: "mock",
  async generateText(req): Promise<GenerateTextResponse> {
    if (req.signal?.aborted) {
      throw new Error("Aborted");
    }
    if (process.env.MOCK_LLM_MODE === "error") {
      throw new Error("Mock LLM error mode enabled");
    }
    const id = hashMessages(req.messages);
    return {
      text: `[mock-${id}] This is a mock response.`,
      usage: { inputTokens: 10, outputTokens: 20 },
    };
  },
};
