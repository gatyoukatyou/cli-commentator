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
import { createSessionContext } from "../session-context.js";

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

  it("keeps supervision explanations in plain Japanese across narration styles", () => {
    const event: Event = {
      ts: 1,
      type: "search",
      summary: "該当箇所を検索している",
      detail: "rg commentary apps/server/src",
    };

    const prompts = styles.map((style) => buildExplanationPrompt(event, style));

    expect(new Set(prompts).size).toBe(1);
    expect(prompts[0]).toContain("口調プリセットに影響されない");
    expect(prompts[0]).toContain("イベントの目的を1つに絞り");
    expect(prompts[0]).not.toContain("関西弁");
    expect(prompts[0]).not.toContain("ずんだもん");
  });

  it("gives narration an explicit Japanese character budget", () => {
    const prompt = buildNarrationPrompt(
      { ts: 1, type: "read", summary: "設定を確認" },
      "standard"
    );

    expect(prompt).toContain("日本語25〜30文字");
    expect(prompt).toContain("必ず30文字以内");
    expect(prompt).toContain("観測された結果・状態変化を優先");
    expect(prompt).toContain("単語や文末を途中で切らない");
  });
});

describe("rule-based supervision layer", () => {
  it("keeps explanations in standard Japanese while narration follows the selected style", async () => {
    const { comment } = await import("../styles/index.js");
    const event: Event = {
      ts: 1,
      type: "test",
      summary: "テストを実行している",
      detail: "pnpm vitest",
    };

    const standard = await comment(event, "standard");
    const kansai = await comment(event, "kansai");
    const zundamon = await comment(event, "zundamon");

    expect(kansai.narration).not.toBe(standard.narration);
    expect(zundamon.narration).not.toBe(standard.narration);
    expect(kansai.explanation).toBe(standard.explanation);
    expect(zundamon.explanation).toBe(standard.explanation);
    expect(kansai.explanation).not.toMatch(/やで|や。|へん|なのだ/u);
  });

  it("keeps context-free output compatible and uses observed context when provided", async () => {
    const { comment } = await import("../styles/index.js");
    const event: Event = {
      ts: 1,
      type: "read",
      summary: "ファイルを読み込んでいる",
      detail: "⏺ Read(apps/server/src/index.ts)",
    };
    const context = createSessionContext();
    expect(await comment(event, "standard", {}, context.snapshot())).toEqual(
      await comment(event, "standard")
    );

    context.setTaskContext({
      objective: "実況のセッション文脈を確認する",
      userPrompt: "実装を読んでください",
      source: "fixture",
    });
    const snapshot = context.observeEvent(event);
    const contextual = await comment(event, "standard", {}, snapshot);
    expect(contextual.narration).toContain("調査段階");
    expect(contextual.narration).toContain("apps/server/src/index.ts");
    expect(contextual.explanation).toContain("実況のセッション文脈を確認する");
    expect(contextual.explanation).not.toMatch(/成功|完了見込み/u);
  });
});

describe("session context prompts", () => {
  it("keeps an unobserved purpose explicitly unknown", () => {
    const event: Event = { ts: 1, type: "stdout", summary: "進行中" };
    const prompt = buildNarrationPrompt(event, "standard", createSessionContext().snapshot());
    expect(prompt).toContain("作業目的: 不明");
    expect(prompt).toContain("不明な目的・結果・成功見込みを補わない");
  });

  it("labels a preset without presenting it as a confirmed objective", () => {
    const context = createSessionContext();
    context.reset({ presetName: "Claude Code 開発用" });
    const prompt = buildNarrationPrompt(
      { ts: 1, type: "start", summary: "開始" },
      "standard",
      context.snapshot()
    );
    expect(prompt).toContain("作業目的: 不明");
    expect(prompt).toContain("起動プリセット: Claude Code 開発用");
    expect(prompt).not.toContain("確認済みの作業目的: Claude Code 開発用");
  });

  it("adds only bounded observed context and omits prior raw event details", () => {
    const context = createSessionContext();
    context.setTaskContext({
      objective: "実況の流れを確認する",
      userPrompt: "関連実装を読んでください",
      source: "fixture",
    });
    context.observeEvent({
      ts: 1,
      type: "search",
      summary: "関連箇所を検索している",
      detail: "rg secret-pattern-that-must-not-enter-history apps/server/src",
    });
    const current: Event = {
      ts: 2,
      type: "read",
      summary: "ファイルを読み込んでいる",
      detail: "⏺ Read(apps/server/src/index.ts)",
    };
    const prompt = buildExplanationPrompt(current, "standard", context.observeEvent(current));

    expect(prompt).toContain("観測済みセッション文脈");
    expect(prompt).toContain("実況の流れを確認する");
    expect(prompt).toContain("調査 (investigation)");
    expect(prompt).toContain("apps/server/src/index.ts");
    expect(prompt).toContain("search:関連箇所を検索している");
    expect(prompt).not.toContain("secret-pattern-that-must-not-enter-history");
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

  it("repairs malformed visible-state phrasing without losing Kansai style", () => {
    expect(
      normalizeGeneratedCommentaryText("今見えていてるで、設定を確認中や。", "narration")
    ).toBe("今見えてるで、設定を確認中や。");
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
    expect(out.explanation).toBeUndefined();

    vi.doUnmock("../llm/factory.js");
  });
});
