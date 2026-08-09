import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { extractEvents, resetExtractionState } from "../extract.js";
import type { EventType, Source } from "../types.js";

type ExpectedEvent = {
  type: EventType;
  summary: string;
};

type RegressionCase = {
  id: string;
  category: string;
  source: Exclude<Source, "auto">;
  provenance: string;
  input: string;
  expected: ExpectedEvent[];
};

type RegressionFixture = {
  notice: string[];
  observedPrefixes: Record<string, string[]>;
  cases: RegressionCase[];
};

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/real-classification-regression.json"
);

function loadFixture(): RegressionFixture {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as RegressionFixture;
}

describe("real classification regression cases", () => {
  beforeEach(() => {
    resetExtractionState();
  });

  it("keeps the six HUMAN-requested categories in one provenance table", () => {
    const fixture = loadFixture();

    expect(fixture.cases.map(({ category }) => category)).toEqual([
      "normal explanation",
      "real error",
      "HUMAN input wait",
      "Git operation",
      "command execution",
      "long explanation",
    ]);
    expect(fixture.cases.every(({ provenance }) => provenance.length > 0)).toBe(true);
    expect(fixture.observedPrefixes).toEqual({
      humanManagedTerminal20260809: ["•", "└"],
      existingSanitizedRealCaptures: ["⏺", "⎿"],
    });
  });

  it.each(loadFixture().cases)("keeps $id classified by type", ({ source, input, expected }) => {
    const actual = extractEvents(input, source).map(({ type, summary }) => ({ type, summary }));

    expect(actual).toEqual(expected);
  });

  it("does not retain the local identity from the HUMAN capture", () => {
    const raw = fs.readFileSync(fixturePath, "utf8");

    expect(raw).not.toContain("/Users/home");
    expect(raw).not.toContain("gatyoukatyou");
    expect(raw).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(raw).toContain("/Users/USER/PROJECT");
  });
});
