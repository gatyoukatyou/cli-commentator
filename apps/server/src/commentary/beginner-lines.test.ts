import { describe, expect, it } from "vitest";
import { beginnerOneLine } from "./beginner-lines.js";

describe("beginnerOneLine stdout explanations", () => {
  it("omits an explanation for a shell prompt or unknown stdout", () => {
    expect(
      beginnerOneLine({ ts: 1, type: "stdout", summary: "ログ更新", detail: "bash-5.3$" }, "standard")
    ).toBe("");
    expect(
      beginnerOneLine({ ts: 1, type: "stdout", summary: "ログ更新", detail: "arbitrary output" }, "kansai")
    ).toBe("");
  });

  it("describes source code, file paths, and test results when identifiable", () => {
    expect(
      beginnerOneLine({ ts: 1, type: "stdout", summary: "ログ更新", detail: "const value = 1;" }, "standard")
    ).toContain("ソースコードの一部");
    expect(
      beginnerOneLine({ ts: 1, type: "stdout", summary: "ログ更新", detail: "apps/web/src/lib/tts.ts" }, "kansai")
    ).toContain("ファイルやフォルダの一覧");
    expect(
      beginnerOneLine({ ts: 1, type: "stdout", summary: "ログ更新", detail: "Tests 5 passed" }, "zundamon")
    ).toContain("テスト結果");
  });

  it("distinguishes reading a file from listing files", () => {
    expect(
      beginnerOneLine(
        { ts: 1, type: "stdout", summary: "ログ更新", detail: "sed -n '1p' apps/server/src/index.ts" },
        "standard"
      )
    ).toContain("ファイルの内容を読み");
    expect(
      beginnerOneLine(
        { ts: 1, type: "stdout", summary: "ログ更新", detail: "rg --files apps/server/src" },
        "kansai"
      )
    ).toContain("一覧を見て");
  });
});
