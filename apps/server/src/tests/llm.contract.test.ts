/**
 * LLM Provider Contract Tests
 *
 * Verifies that all LLM providers implement the same contract:
 * 1. Returns { text: string } on success
 * 2. Throws CommentError("comment_llm_error") for empty response
 * 3. Throws CommentError("comment_aborted") when signal is pre-aborted
 * 4. Throws CommentError("comment_aborted") when aborted during fetch
 * 5. Throws CommentError("comment_llm_error") on network failure
 * 6. Throws CommentError("comment_llm_error") on HTTP 4xx/5xx
 * 7. Throws CommentError("comment_llm_error") on invalid JSON
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLLMAdapter } from "../llm/factory.js";
import { CommentError } from "../errors.js";
import type { LLMAdapter } from "../llm/adapter.js";

// Provider configurations for testing
const PROVIDERS = [
  {
    name: "openai",
    env: { LLM_PROVIDER: "openai", OPENAI_API_KEY: "test-key" },
  },
  {
    name: "deepseek",
    env: { LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "test-key" },
  },
  {
    name: "groq",
    env: { LLM_PROVIDER: "groq", GROQ_API_KEY: "test-key" },
  },
  {
    name: "local",
    env: { LLM_PROVIDER: "local" },
  },
  {
    name: "gemini",
    env: { LLM_PROVIDER: "gemini", GOOGLE_API_KEY: "test-key" },
  },
  {
    name: "anthropic",
    env: { LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key" },
  },
] as const;

// Mock responses for each provider type
function getMockSuccessResponse(providerName: string): unknown {
  switch (providerName) {
    case "openai":
    case "deepseek":
    case "groq":
    case "local":
      return {
        choices: [{ message: { content: "test response" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      };
    case "gemini":
      return {
        candidates: [{ content: { parts: [{ text: "test response" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      };
    case "anthropic":
      return {
        content: [{ type: "text", text: "test response" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    default:
      throw new Error(`Unknown provider: ${providerName}`);
  }
}

function getMockEmptyResponse(providerName: string): unknown {
  switch (providerName) {
    case "openai":
    case "deepseek":
    case "groq":
    case "local":
      return { choices: [] };
    case "gemini":
      return { candidates: [] };
    case "anthropic":
      return { content: [] };
    default:
      throw new Error(`Unknown provider: ${providerName}`);
  }
}

function getMockHttpErrorResponse(providerName: string): unknown {
  switch (providerName) {
    case "openai":
    case "deepseek":
    case "groq":
    case "local":
      return { error: { message: "Unauthorized" } };
    case "gemini":
      return { error: { message: "Unauthorized", code: 401 } };
    case "anthropic":
      return { error: { message: "Unauthorized", type: "authentication_error" } };
    default:
      throw new Error(`Unknown provider: ${providerName}`);
  }
}

// Test request
const TEST_REQUEST = {
  messages: [{ role: "user" as const, content: "Hello" }],
};

describe.each(PROVIDERS)("LLM Contract: $name", ({ name, env }) => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let adapter: LLMAdapter;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    adapter = createLLMAdapter(env);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  // Contract 1: Returns text string on success
  it("returns text string on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => getMockSuccessResponse(name),
    });

    const result = await adapter.generateText(TEST_REQUEST);

    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).toBe("test response");
  });

  // Contract 2: Throws comment_llm_error for empty response
  it("throws comment_llm_error for empty response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => getMockEmptyResponse(name),
    });

    try {
      await adapter.generateText(TEST_REQUEST);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CommentError);
      expect((err as CommentError).code).toBe("comment_llm_error");
    }
  });

  // Contract 3: Throws comment_aborted when signal is already aborted
  it("throws comment_aborted when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    try {
      await adapter.generateText({
        ...TEST_REQUEST,
        signal: controller.signal,
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CommentError);
      expect((err as CommentError).code).toBe("comment_aborted");
    }

    // fetch should not be called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Contract 4: Throws comment_aborted when aborted during fetch
  it("throws comment_aborted when aborted during fetch", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    mockFetch.mockRejectedValueOnce(abortError);

    try {
      await adapter.generateText(TEST_REQUEST);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CommentError);
      expect((err as CommentError).code).toBe("comment_aborted");
    }
  });

  // Contract 5: Throws comment_llm_error on network failure
  it("throws comment_llm_error on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    try {
      await adapter.generateText(TEST_REQUEST);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CommentError);
      expect((err as CommentError).code).toBe("comment_llm_error");
    }
  });

  // Contract 6: Throws comment_llm_error on HTTP 4xx/5xx
  it("throws comment_llm_error on HTTP 4xx/5xx", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => getMockHttpErrorResponse(name),
    });

    try {
      await adapter.generateText(TEST_REQUEST);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CommentError);
      expect((err as CommentError).code).toBe("comment_llm_error");
    }
  });

  // Contract 7: Throws comment_llm_error on invalid JSON
  it("throws comment_llm_error on invalid JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    });

    try {
      await adapter.generateText(TEST_REQUEST);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CommentError);
      expect((err as CommentError).code).toBe("comment_llm_error");
    }
  });
});
