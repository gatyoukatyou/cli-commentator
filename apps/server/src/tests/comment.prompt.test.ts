import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Event, Style } from "../types.js";
import {
  buildExplanationPrompt,
  buildNarrationPrompt,
  normalizeGeneratedCommentaryText,
} from "../styles/prompt.js";

type PromptFixture = {
  id: string;
  intent: string;
  event: Event;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../../test/fixtures/commentary-prompt.events.json");

const styles: Style[] = ["standard", "kansai", "zundamon"];

async function loadFixtures(): Promise<PromptFixture[]> {
  const raw = await fs.readFile(fixturesPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("commentary-prompt fixtures must be a non-empty array");
  }

  const ids = new Set<string>();
  for (const entry of parsed) {
    const fixture = entry as Partial<PromptFixture>;
    if (!fixture.id || !fixture.intent?.trim()) {
      throw new Error("commentary-prompt fixtures require non-empty id and intent");
    }
    if (ids.has(fixture.id)) {
      throw new Error(`duplicate commentary-prompt fixture id: ${fixture.id}`);
    }
    ids.add(fixture.id);
  }

  return parsed as PromptFixture[];
}

describe("commentary prompt fixtures", () => {
  it("builds event-aware narration and explanation prompts", async () => {
    const fixtures = await loadFixtures();
    const output = fixtures.map((fixture) => ({
      id: fixture.id,
      intent: fixture.intent,
      prompts: styles.map((style) => ({
        style,
        narrationPrompt: buildNarrationPrompt(fixture.event, style),
        explanationPrompt: buildExplanationPrompt(fixture.event, style),
      })),
    }));

    expect(output).toMatchSnapshot();
  });
});

describe("normalizeGeneratedCommentaryText", () => {
  it("keeps narration to the first sentence and strips labels", () => {
    expect(
      normalizeGeneratedCommentaryText("実況: テストを走らせています。次の行も説明します。", "narration")
    ).toBe("テストを走らせています。");
  });

  it("strips memo-like explanation prefixes", () => {
    expect(
      normalizeGeneratedCommentaryText("1行メモ: 設定の前提を確認しています。補足を続けます。", "explanation")
    ).toBe("設定の前提を確認しています。");
  });
});

describe("comment() quality fallback", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it("falls back to rules when all configured providers fail", async () => {
    vi.doMock("../llm/factory.js", () => ({
      createLLMAdapter: () => ({
        name: "failing",
        async generateText() {
          throw new Error("boom");
        },
      }),
    }));

    const { comment } = await import("../styles/index.js");
    const ev: Event = {
      ts: Date.now(),
      type: "stdout",
      summary: "ログ更新",
    };

    const out = await comment(ev, "standard", {
      narrationProvider: "mock",
      explanationProvider: "mock",
    });

    expect(out.meta?.narrationProvider).toBe("rules");
    expect(out.meta?.explanationProvider).toBe("rules");
    expect(out.narration).not.toContain("[mock-");
    expect(out.explanation).toBeTruthy();

    vi.doUnmock("../llm/factory.js");
  });
});
