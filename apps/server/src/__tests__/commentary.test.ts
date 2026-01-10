import { describe, expect, it } from "vitest";
import { comment } from "../styles/index.js";
import type { Event, Style } from "../types.js";

describe("commentary", () => {
  it("renders styles consistently", () => {
    const ev: Event = {
      ts: 1735689600000,
      type: "search",
      summary: "該当箇所を検索している",
      detail: "rg -n \"TODO\" src (pnpm)"
    };

    const styles: Style[] = ["standard", "kansai", "zundamon"];
    const output = styles.map((style) => ({ style, text: comment(ev, style) }));

    expect(output).toMatchSnapshot();
  });
});
