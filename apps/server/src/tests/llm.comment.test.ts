import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Event } from "../types.js";

describe("comment() with LLM_PROVIDER=mock", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("includes [mock- prefix when LLM_PROVIDER=mock", async () => {
    process.env.LLM_PROVIDER = "mock";

    const { comment } = await import("../styles/index.js");

    const ev: Event = {
      ts: Date.now(),
      type: "search",
      summary: "ファイルを検索中",
      detail: "rg -n pattern"
    };

    const out = await comment(ev, "standard");
    expect(out.narration).toContain("[mock-");
    expect(out.explanation).toContain("[mock-");
    expect(out.meta?.narrationProvider).toBe("mock");
    expect(out.meta?.explanationProvider).toBe("mock");
  });

  it("uses rule-based commentary when LLM_PROVIDER is not set", async () => {
    delete process.env.LLM_PROVIDER;

    const { comment } = await import("../styles/index.js");

    const ev: Event = {
      ts: Date.now(),
      type: "search",
      summary: "ファイルを検索中",
      detail: "rg -n pattern"
    };

    const out = await comment(ev, "standard");
    expect(out.narration).not.toContain("[mock-");
    expect(out.explanation).toBeTruthy();
    expect(out.glossaryNotes).toBeInstanceOf(Array);
  });

  it("supports new provider fields without legacy llmProvider", async () => {
    delete process.env.LLM_PROVIDER;

    const { comment } = await import("../styles/index.js");

    const ev: Event = {
      ts: Date.now(),
      type: "search",
      summary: "ファイルを検索中",
      detail: "rg -n pattern"
    };

    const out = await comment(ev, "standard", {
      narrationProvider: "mock",
      explanationProvider: "mock",
    });

    expect(out.narration).toContain("[mock-");
    expect(out.explanation).toContain("[mock-");
    expect(out.meta?.narrationProvider).toBe("mock");
    expect(out.meta?.explanationProvider).toBe("mock");
  });

  it("uses legacy llmProvider as fallback for the side that is still unset", async () => {
    delete process.env.LLM_PROVIDER;

    const { comment } = await import("../styles/index.js");

    const ev: Event = {
      ts: Date.now(),
      type: "search",
      summary: "ファイルを検索中",
      detail: "rg -n pattern"
    };

    const out = await comment(ev, "standard", {
      llmProvider: "mock",
      narrationProvider: "disabled",
    });

    expect(out.narration).not.toContain("[mock-");
    expect(out.explanation).toContain("[mock-");
    expect(out.meta?.narrationProvider).toBe("rules");
    expect(out.meta?.explanationProvider).toBe("mock");
  });
});
