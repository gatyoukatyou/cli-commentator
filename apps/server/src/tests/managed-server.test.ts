import { describe, expect, it } from "vitest";
import { isManagedServer } from "../runtime/managed-server.js";

describe("isManagedServer", () => {
  it("enables managed lifecycle only for the explicit desktop flag", () => {
    expect(isManagedServer({ CLI_COMMENTATOR_MANAGED_SERVER: "1" })).toBe(true);
    expect(isManagedServer({ CLI_COMMENTATOR_MANAGED_SERVER: " 1 " })).toBe(true);
  });

  it.each([
    undefined,
    "",
    "0",
    "true",
    "yes",
  ])("keeps standalone lifecycle for flag %j", (value) => {
    expect(isManagedServer({ CLI_COMMENTATOR_MANAGED_SERVER: value })).toBe(false);
  });
});
