import { describe, expect, it } from "vitest";
import { comment } from "../styles/index.js";
import type { Event, Style } from "../types.js";

describe("commentary", () => {
  it("renders styles consistently", async () => {
    const ev: Event = {
      ts: 1735689600000,
      type: "search",
      summary: "該当箇所を検索している",
      detail: "rg -n \"TODO\" src (pnpm)"
    };

    const styles: Style[] = ["standard", "kansai", "zundamon"];
    const output = await Promise.all(
      styles.map(async (style) => ({ style, text: await comment(ev, style) }))
    );

    expect(output).toMatchSnapshot();
  });
});
