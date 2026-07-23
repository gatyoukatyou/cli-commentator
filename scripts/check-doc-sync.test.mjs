import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { findViolations } from "./check-doc-sync.mjs";
import {
  computeDesktopSidecarFingerprint,
  listDesktopSidecarInputFiles,
} from "./desktop-sidecar-fingerprint.mjs";

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

test("ignores auto-generated tauri schema updates", () => {
  assert.deepEqual(
    findViolations([
      "apps/desktop/src-tauri/gen/schemas/acl-manifests.json",
      "apps/desktop/src-tauri/gen/schemas/desktop-schema.json",
      "apps/desktop/src-tauri/gen/schemas/macOS-schema.json",
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

function createFingerprintFixture() {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "sidecar-fingerprint-"));
  const files = {
    "package.json": "{}\n",
    "pnpm-lock.yaml": "lockfileVersion: 9\n",
    "pnpm-workspace.yaml": "packages: []\n",
    "apps/server/package.json": "{}\n",
    "apps/server/tsconfig.build.json": "{}\n",
    "apps/server/src/index.ts": "export const server = true;\n",
    "packages/shared/package.json": "{}\n",
    "packages/shared/src/index.ts": "export const shared = true;\n",
    "scripts/desktop-sidecar-fingerprint.mjs": "fingerprint helper\n",
    "scripts/prepare-desktop-sidecar.mjs": "prepare script\n",
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(repoRoot, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return repoRoot;
}

test("desktop sidecar fingerprint is stable when inputs are unchanged", () => {
  const repoRoot = createFingerprintFixture();

  assert.equal(
    computeDesktopSidecarFingerprint(repoRoot),
    computeDesktopSidecarFingerprint(repoRoot)
  );
});

test("desktop sidecar fingerprint changes with server source", () => {
  const repoRoot = createFingerprintFixture();
  const before = computeDesktopSidecarFingerprint(repoRoot);

  writeFileSync(
    path.join(repoRoot, "apps/server/src/index.ts"),
    "export const server = false;\n"
  );

  assert.notEqual(computeDesktopSidecarFingerprint(repoRoot), before);
});

test("desktop sidecar fingerprint changes with lockfile and shared source", () => {
  const repoRoot = createFingerprintFixture();
  const before = computeDesktopSidecarFingerprint(repoRoot);

  writeFileSync(
    path.join(repoRoot, "pnpm-lock.yaml"),
    "lockfileVersion: 9\npackages: changed\n"
  );
  const afterLockfile = computeDesktopSidecarFingerprint(repoRoot);
  assert.notEqual(afterLockfile, before);

  writeFileSync(
    path.join(repoRoot, "packages/shared/src/index.ts"),
    "export const shared = false;\n"
  );
  assert.notEqual(
    computeDesktopSidecarFingerprint(repoRoot),
    afterLockfile
  );
});

test("desktop sidecar fingerprint records missing required inputs", () => {
  const repoRoot = createFingerprintFixture();
  const missing = "apps/server/tsconfig.build.json";
  rmSync(path.join(repoRoot, missing));

  const files = listDesktopSidecarInputFiles(repoRoot);
  assert.ok(
    files.some(
      (file) =>
        file.relativePath === missing &&
        file.missing === true
    )
  );
});
