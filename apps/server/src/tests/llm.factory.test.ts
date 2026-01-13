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

  it("returns anthropic adapter when LLM_PROVIDER=anthropic with API key", () => {
    const adapter = createLLMAdapter({
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "test-key",
    });
    expect(adapter.name).toBe("anthropic");
  });

  it("throws when anthropic provider lacks API key", () => {
    expect(() => createLLMAdapter({ LLM_PROVIDER: "anthropic" })).toThrow(
      /ANTHROPIC_API_KEY is required/
    );
  });

  it("returns gemini adapter when LLM_PROVIDER=gemini with API key", () => {
    const adapter = createLLMAdapter({
      LLM_PROVIDER: "gemini",
      GOOGLE_API_KEY: "test-key",
    });
    expect(adapter.name).toBe("gemini");
  });

  it("throws when gemini provider lacks API key", () => {
    expect(() => createLLMAdapter({ LLM_PROVIDER: "gemini" })).toThrow(
      /GOOGLE_API_KEY is required/
    );
  });

  it("returns local adapter when LLM_PROVIDER=local", () => {
    // local doesn't require any env vars, uses defaults
    const adapter = createLLMAdapter({ LLM_PROVIDER: "local" });
    expect(adapter.name).toBe("local");
  });

  it("returns groq adapter when LLM_PROVIDER=groq with API key", () => {
    const adapter = createLLMAdapter({
      LLM_PROVIDER: "groq",
      GROQ_API_KEY: "gsk-test",
    });
    expect(adapter.name).toBe("groq");
  });

  it("throws when groq provider lacks API key", () => {
    expect(() => createLLMAdapter({ LLM_PROVIDER: "groq" })).toThrow(
      /GROQ_API_KEY is required/
    );
  });

  it("returns openai adapter when LLM_PROVIDER=openai with API key", () => {
    const adapter = createLLMAdapter({
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
    });
    expect(adapter.name).toBe("openai");
  });

  it("throws when openai provider lacks API key", () => {
    expect(() => createLLMAdapter({ LLM_PROVIDER: "openai" })).toThrow(
      /OPENAI_API_KEY is required/
    );
  });
});
