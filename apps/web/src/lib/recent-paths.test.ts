import { describe, expect, it } from "vitest";
import { addRecentPath, normalizeRecentPath } from "./recent-paths";

describe("recent-paths", () => {
  it("normalizes empty values to null", () => {
    expect(normalizeRecentPath("   ")).toBeNull();
    expect(normalizeRecentPath(" /tmp/project ")).toBe("/tmp/project");
  });

  it("prepends new paths and removes duplicates", () => {
    expect(addRecentPath(["/a", "/b"], " /c ")).toEqual(["/c", "/a", "/b"]);
    expect(addRecentPath(["/a", "/b"], "/a")).toEqual(["/a", "/b"]);
  });

  it("limits history length", () => {
    expect(addRecentPath(["/1", "/2", "/3", "/4", "/5", "/6"], "/7")).toEqual(["/7", "/1", "/2", "/3", "/4", "/5"]);
  });
});
