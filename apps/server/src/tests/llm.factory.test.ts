import { describe, it, expect } from "vitest";
import { createLLMAdapter } from "../llm/factory.js";

describe("createLLMAdapter", () => {
  it("returns mock adapter when LLM_PROVIDER=mock", () => {
    const adapter = createLLMAdapter({ LLM_PROVIDER: "mock" });
    expect(adapter.name).toBe("mock");
  });

  it("returns disabled adapter when LLM_PROVIDER is not set", () => {
    const adapter = createLLMAdapter({});
    expect(adapter.name).toBe("disabled");
  });

  it("returns disabled adapter when LLM_PROVIDER=disabled", () => {
    const adapter = createLLMAdapter({ LLM_PROVIDER: "disabled" });
    expect(adapter.name).toBe("disabled");
  });

  it("throws for invalid provider", () => {
    expect(() => createLLMAdapter({ LLM_PROVIDER: "invalid" })).toThrow(
      /Invalid LLM_PROVIDER.*Valid values/
    );
  });

  it("throws for unimplemented providers", () => {
    expect(() => createLLMAdapter({ LLM_PROVIDER: "openai" })).toThrow(
      /not yet implemented/
    );
  });
});
