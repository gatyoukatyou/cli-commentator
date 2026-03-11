import { describe, expect, it } from "vitest";
import { buildCombinedCommentaryText, buildSpeechText, getCommentaryTextParts } from "./glossary-note";

describe("getCommentaryTextParts", () => {
  it("uses structured payload as the primary source", () => {
    const result = getCommentaryTextParts({
      narration: "原因を検索しています。",
      explanation: "TODO を手がかりに調べています。",
      glossaryNotes: ["補足: rg は高速検索コマンド", "補足: git は履歴管理"],
    });

    expect(result.narrationText).toBe("原因を検索しています。");
    expect(result.explanationText).toBe("TODO を手がかりに調べています。");
    expect(result.glossaryNotes).toEqual(["補足: rg は高速検索コマンド", "補足: git は履歴管理"]);
  });

  it("falls back to legacy commentary text", () => {
    const result = getCommentaryTextParts({
      text: "原因を検索しています。 1行メモ: 調査中です。 （補足: rg は高速検索コマンド / 補足: git は履歴管理）",
    });

    expect(result.narrationText).toBe("原因を検索しています。");
    expect(result.explanationText).toBe("調査中です。");
    expect(result.glossaryNotes).toEqual(["補足: rg は高速検索コマンド", "補足: git は履歴管理"]);
  });

  it("merges structured fields with legacy fallback when partial payload is received", () => {
    const result = getCommentaryTextParts({
      narration: "構造化された実況です。",
      text: "旧形式の実況です。 1行メモ: 旧形式の解説です。 （補足: rg は高速検索コマンド）",
    });

    expect(result.narrationText).toBe("構造化された実況です。");
    expect(result.explanationText).toBe("旧形式の解説です。");
    expect(result.glossaryNotes).toEqual(["補足: rg は高速検索コマンド"]);
  });
});

describe("buildCombinedCommentaryText", () => {
  it("combines narration and explanation for search/filter use", () => {
    expect(
      buildCombinedCommentaryText({
        narrationText: "関連箇所を探しています。",
        explanationText: "TODO を手がかりに見ています。",
        glossaryNotes: [],
      })
    ).toBe("関連箇所を探しています。 TODO を手がかりに見ています。");
  });
});

describe("buildSpeechText", () => {
  const parts = {
    narrationText: "原因を検索しています。",
    explanationText: "TODO を手がかりに調べています。",
    glossaryNotes: ["補足: rg は高速検索コマンド"],
  };

  it("reads both narration and explanation by default", () => {
    expect(buildSpeechText(parts)).toBe("原因を検索しています。 TODO を手がかりに調べています。");
  });

  it("reads only narration for repeated grouped items in both mode", () => {
    expect(buildSpeechText(parts, 3)).toBe("原因を検索しています。");
  });

  it("supports narration-only mode", () => {
    expect(buildSpeechText(parts, 1, undefined, "narration")).toBe("原因を検索しています。");
  });

  it("supports explanation-only mode", () => {
    expect(buildSpeechText(parts, 1, undefined, "explanation")).toBe("TODO を手がかりに調べています。");
  });

  it("keeps explanation in explanation-only mode even for repeated groups", () => {
    expect(buildSpeechText(parts, 3, undefined, "explanation")).toBe("TODO を手がかりに調べています。");
  });

  it("appends raw detail when requested", () => {
    expect(buildSpeechText(parts, 1, 'rg -n "TODO" src')).toBe(
      '原因を検索しています。 TODO を手がかりに調べています。 原文 rg -n "TODO" src'
    );
  });
});
