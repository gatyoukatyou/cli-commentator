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
    expect(out).toContain("[mock-");
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
    // ルール実況は [mock- を含まない
    expect(out).not.toContain("[mock-");
    // ルール実況の特徴的なフレーズを含む
    expect(out).toContain("初心者向け");
  });
});
