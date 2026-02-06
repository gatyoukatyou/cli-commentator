import { describe, expect, it } from "vitest";
import { resolveFileFallback } from "../input/fallback.js";

describe("input/fallback", () => {
  it("returns missing_input_file when INPUT_FILE is empty", () => {
    const decision = resolveFileFallback("", () => true);
    expect(decision).toEqual({ enabled: false, reason: "missing_input_file" });
  });

  it("returns file_not_found when INPUT_FILE does not exist", () => {
    const decision = resolveFileFallback("/tmp/missing.log", () => false);
    expect(decision).toEqual({ enabled: false, reason: "file_not_found" });
  });

  it("returns enabled decision when INPUT_FILE exists", () => {
    const decision = resolveFileFallback("/tmp/app.log", () => true);
    expect(decision).toEqual({ enabled: true, filePath: "/tmp/app.log" });
  });

  it("trims whitespace around INPUT_FILE", () => {
    const decision = resolveFileFallback("  /tmp/app.log  ", () => true);
    expect(decision).toEqual({ enabled: true, filePath: "/tmp/app.log" });
  });
});
