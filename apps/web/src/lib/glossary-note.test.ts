import { describe, expect, it } from "vitest";
import { splitGlossaryNote } from "./glossary-note";

describe("splitGlossaryNote", () => {
  it("splits trailing glossary note in full-width parentheses", () => {
    const text = "原因を検索しています。 1行メモ: 調査中です。 （rg= ripgrep / git=履歴管理）";
    const result = splitGlossaryNote(text);
    expect(result.mainText).toBe("原因を検索しています。 1行メモ: 調査中です。");
    expect(result.noteText).toBe("rg= ripgrep / git=履歴管理");
  });

  it("keeps text unchanged when note is absent", () => {
    const text = "通常の実況テキストです。";
    const result = splitGlossaryNote(text);
    expect(result.mainText).toBe("通常の実況テキストです。");
    expect(result.noteText).toBeNull();
  });

  it("keeps text unchanged when parentheses are in the middle", () => {
    const text = "説明（補足）を含む実況です。次へ進みます。";
    const result = splitGlossaryNote(text);
    expect(result.mainText).toBe(text);
    expect(result.noteText).toBeNull();
  });
});
