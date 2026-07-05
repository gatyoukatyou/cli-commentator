import assert from "node:assert/strict";
import test from "node:test";

import { findViolations } from "./check-doc-sync.mjs";

test("ignores Cargo.lock-only desktop dependency updates", () => {
  assert.deepEqual(
    findViolations(["apps/desktop/src-tauri/Cargo.lock"]),
    []
  );
});

test("still requires docs for desktop release workflow changes", () => {
  const violations = findViolations([".github/workflows/release-desktop.yml"]);

  assert.equal(violations.length, 1);
  assert.equal(violations[0].ruleId, "desktop-distribution-doc-sync");
  assert.deepEqual(violations[0].matchedFiles, [
    ".github/workflows/release-desktop.yml",
  ]);
});

test("accepts desktop release workflow changes with an operations doc", () => {
  assert.deepEqual(
    findViolations([
      ".github/workflows/release-desktop.yml",
      "docs/release-runbook.en.md",
    ]),
    []
  );
});

test("still requires docs for desktop runtime source changes", () => {
  const violations = findViolations([
    "apps/desktop/src-tauri/src/main.rs",
  ]);

  assert.equal(violations.length, 1);
  assert.equal(violations[0].ruleId, "desktop-distribution-doc-sync");
});
