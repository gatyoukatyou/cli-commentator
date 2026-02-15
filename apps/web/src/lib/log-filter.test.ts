import { describe, expect, it } from "vitest";
import { filterCommentaryItems, type CommentaryItem } from "./log-filter";

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
