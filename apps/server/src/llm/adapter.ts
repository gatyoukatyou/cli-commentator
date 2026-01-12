import type { ProviderName, GenerateTextRequest, GenerateTextResponse } from "./types.js";

export interface LLMAdapter {
  name: ProviderName;
  generateText(req: GenerateTextRequest): Promise<GenerateTextResponse>;
}
