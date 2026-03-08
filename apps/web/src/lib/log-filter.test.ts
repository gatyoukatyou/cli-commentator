import { describe, expect, it } from "vitest";
import { filterCommentaryItems, groupCommentaryItems, type CommentaryItem } from "./log-filter";

const baseItems: CommentaryItem[] = [
  {
    ts: 1,
    text: "原因になりそうな箇所を検索しています。",
    eventType: "search",
    summary: "該当箇所を検索している",
    detail: "rg -n TODO src",
  },
  {
    ts: 2,
    text: "GitHub上のIssue/PRを操作しています。",
    eventType: "github",
    summary: "GitHub操作をしている",
    detail: "gh pr checks 123",
  },
  {
    ts: 3,
    text: "エラーが出ています。原因特定が必要です。",
    eventType: "error",
    summary: "エラーが出ている",
    detail: "Command failed with exit code 1",
  },
];

describe("filterCommentaryItems", () => {
  it("returns all items with no query and all filter", () => {
    const result = filterCommentaryItems(baseItems, { query: "", eventType: "all" });
    expect(result).toHaveLength(3);
  });

  it("filters by event type", () => {
    const result = filterCommentaryItems(baseItems, { query: "", eventType: "github" });
    expect(result).toHaveLength(1);
    expect(result[0].eventType).toBe("github");
  });

  it("filters by keyword in text/detail (case-insensitive)", () => {
    const result = filterCommentaryItems(baseItems, { query: "EXIT CODE", eventType: "all" });
    expect(result).toHaveLength(1);
    expect(result[0].eventType).toBe("error");
  });

  it("filters by localized event label keyword", () => {
    const result = filterCommentaryItems(baseItems, { query: "github", eventType: "all" });
    expect(result).toHaveLength(1);
    expect(result[0].eventType).toBe("github");
  });

  it("keeps responsiveness with 200+ items", () => {
    const large = Array.from({ length: 220 }, (_, i): CommentaryItem => ({
      ts: i,
      text: `log-${i}`,
      eventType: i % 2 === 0 ? "stdout" : "search",
      detail: i % 15 === 0 ? "needle" : "",
    }));

    const result = filterCommentaryItems(large, { query: "needle", eventType: "search" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((item) => item.eventType === "search")).toBe(true);
  });
});

describe("groupCommentaryItems", () => {
  it("groups consecutive items when event type and main commentary match", () => {
    const grouped = groupCommentaryItems([
      {
        ts: 1000,
        text: "関連箇所を探しています。 1行メモ: キーワードAで検索中です。",
        eventType: "search",
        detail: 'rg -n "keywordA" src',
      },
      {
        ts: 5000,
        text: "関連箇所を探しています。 1行メモ: キーワードBで検索中です。",
        eventType: "search",
        detail: 'rg -n "keywordB" src',
      },
      {
        ts: 9000,
        text: "README を読んで前提を確認しています。 1行メモ: 手順を確認しています。",
        eventType: "read",
        detail: "Read(README.md)",
      },
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0].count).toBe(2);
    expect(grouped[0].latest.detail).toBe('rg -n "keywordB" src');
    expect(grouped[1].count).toBe(1);
  });

  it("does not group when the main commentary differs", () => {
    const grouped = groupCommentaryItems([
      {
        ts: 1000,
        text: "関連箇所を探しています。",
        eventType: "search",
      },
      {
        ts: 2000,
        text: "README を読んで前提を確認しています。",
        eventType: "search",
      },
    ]);

    expect(grouped).toHaveLength(2);
  });

  it("does not group non-groupable event types", () => {
    const grouped = groupCommentaryItems([
      {
        ts: 1000,
        text: "エラーが出ています。",
        eventType: "error",
      },
      {
        ts: 2000,
        text: "エラーが出ています。",
        eventType: "error",
      },
    ]);

    expect(grouped).toHaveLength(2);
  });

  it("does not group when the time gap is too large", () => {
    const grouped = groupCommentaryItems([
      {
        ts: 1000,
        text: "関連箇所を探しています。",
        eventType: "search",
      },
      {
        ts: 20000,
        text: "関連箇所を探しています。",
        eventType: "search",
      },
    ]);

    expect(grouped).toHaveLength(2);
  });
});
