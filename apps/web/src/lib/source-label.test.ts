import { describe, expect, it } from "vitest";
import { sourceLabel } from "./source-label";

describe("source labels", () => {
  it("uses Hermes Agent as the human-facing label", () => {
    expect(sourceLabel("hermes")).toBe("Hermes Agent");
  });
});
