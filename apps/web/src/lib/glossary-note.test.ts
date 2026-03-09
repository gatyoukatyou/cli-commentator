import { describe, expect, it } from "vitest";
import { buildSpeechText, splitGlossaryNote } from "./glossary-note";

describe("splitGlossaryNote", () => {
  it("splits memo and trailing glossary note", () => {
    const text = "原因を検索しています。 1行メモ: 調査中です。 （補足: rg は高速検索コマンド / 補足: git は履歴管理）";
    const result = splitGlossaryNote(text);
    expect(result.mainText).toBe("原因を検索しています。");
    expect(result.memoText).toBe("調査中です。");
    expect(result.noteText).toBe("補足: rg は高速検索コマンド / 補足: git は履歴管理");
  });

  it("keeps text unchanged when note is absent", () => {
    const text = "通常の実況テキストです。";
    const result = splitGlossaryNote(text);
    expect(result.mainText).toBe("通常の実況テキストです。");
    expect(result.memoText).toBeNull();
    expect(result.noteText).toBeNull();
  });

  it("keeps text unchanged when parentheses are in the middle", () => {
    const text = "説明（補足）を含む実況です。次へ進みます。";
    const result = splitGlossaryNote(text);
    expect(result.mainText).toBe(text);
    expect(result.memoText).toBeNull();
    expect(result.noteText).toBeNull();
  });

  it("splits memo even when glossary note is absent", () => {
    const text = "ファイルを読んで状況確認しています。 1行メモ: README を読んで前提を確認しています。";
    const result = splitGlossaryNote(text);
    expect(result.mainText).toBe("ファイルを読んで状況確認しています。");
    expect(result.memoText).toBe("README を読んで前提を確認しています。");
    expect(result.noteText).toBeNull();
  });

  it("builds speech text without glossary notes", () => {
    const text = "原因を検索しています。 1行メモ: TODO を手がかりに調べています。 （補足: rg は高速検索コマンド）";
    expect(buildSpeechText(text)).toBe("原因を検索しています。 TODO を手がかりに調べています。");
  });

  it("uses only the main commentary for repeated items", () => {
    const text = "関連箇所を探しています。 1行メモ: キーワードを変えながら確認しています。";
    expect(buildSpeechText(text, 3)).toBe("関連箇所を探しています。");
  });

  it("appends raw detail when requested", () => {
    const text = "関連箇所を探しています。 1行メモ: TODO を手がかりに見ています。";
    expect(buildSpeechText(text, 1, 'rg -n "TODO" src')).toBe(
      '関連箇所を探しています。 TODO を手がかりに見ています。 原文 rg -n "TODO" src'
    );
  });
});
