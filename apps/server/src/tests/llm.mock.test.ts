import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockAdapter } from "../llm/providers/mock.js";

describe("mockAdapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns deterministic response for same input", async () => {
    const messages = [{ role: "user" as const, content: "Hello" }];
    const res1 = await mockAdapter.generateText({ messages });
    const res2 = await mockAdapter.generateText({ messages });
    expect(res1.text).toBe(res2.text);
  });

  it("returns different response for different input", async () => {
    const res1 = await mockAdapter.generateText({ messages: [{ role: "user", content: "A" }] });
    const res2 = await mockAdapter.generateText({ messages: [{ role: "user", content: "B" }] });
    expect(res1.text).not.toBe(res2.text);
  });

  it("throws when MOCK_LLM_MODE=error", async () => {
    process.env.MOCK_LLM_MODE = "error";
    await expect(mockAdapter.generateText({ messages: [] })).rejects.toThrow(
      /Mock LLM error mode/
    );
  });
});
