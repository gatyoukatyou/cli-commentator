import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPECTED_NODE_MAJOR,
  STATUS,
  STEPS,
  formatCommand,
  formatSummary,
  parseArgs,
  preflight,
  selectSteps,
  summarize,
} from "./check-local-readiness.mjs";

test("runs the roadmap-listed checks in order", () => {
  const ids = STEPS.map((step) => step.id);

  assert.deepEqual(ids.slice(0, 4), [
    "desktop-sidecar",
    "web-lint",
    "web-build",
    "server-test",
  ]);
  assert.ok(ids.includes("desktop-cargo-test"));
});

test("server tests run once instead of entering vitest watch mode", () => {
  const serverTest = STEPS.find((step) => step.id === "server-test");

  assert.ok(serverTest.args.includes("run"));
  assert.ok(!serverTest.args.includes("test"));
});

test("--skip-desktop keeps only the web/server steps", () => {
  const selected = selectSteps(STEPS, { skipDesktop: true });

  assert.deepEqual(
    selected.map((step) => step.id),
    ["web-lint", "web-build", "server-test", "server-typecheck"]
  );
});

test("parseArgs reports unknown options instead of ignoring them", () => {
  assert.equal(parseArgs(["--list"]).list, true);
  assert.equal(parseArgs(["--skip-desktop"]).skipDesktop, true);
  assert.equal(parseArgs(["--nope"]).unknown, "--nope");
});

test("preflight fails fast when dependencies are not installed", () => {
  const result = preflight({
    nodeVersion: `v${EXPECTED_NODE_MAJOR}.0.0`,
    hasNodeModules: false,
    hasPnpm: true,
  });

  assert.match(result.fatal, /pnpm install/);
});

test("preflight fails fast when pnpm is missing", () => {
  const result = preflight({
    nodeVersion: `v${EXPECTED_NODE_MAJOR}.0.0`,
    hasNodeModules: true,
    hasPnpm: false,
  });

  assert.match(result.fatal, /corepack/);
});

test("preflight only warns when the Node major differs from CI", () => {
  const result = preflight({
    nodeVersion: `v${EXPECTED_NODE_MAJOR + 2}.1.0`,
    hasNodeModules: true,
    hasPnpm: true,
  });

  assert.equal(result.fatal, null);
  assert.equal(result.notes.length, 1);
  assert.match(result.notes[0], new RegExp(`Node ${EXPECTED_NODE_MAJOR}`));
});

test("preflight stays quiet on the CI Node version", () => {
  const result = preflight({
    nodeVersion: `v${EXPECTED_NODE_MAJOR}.11.0`,
    hasNodeModules: true,
    hasPnpm: true,
  });

  assert.equal(result.fatal, null);
  assert.deepEqual(result.notes, []);
});

test("a skipped step does not fail the overall run", () => {
  const totals = summarize([
    { status: STATUS.pass },
    { status: STATUS.skip },
    { status: STATUS.pass },
  ]);

  assert.deepEqual(totals, { pass: 2, fail: 0, skip: 1, ok: true });
});

test("a failed step fails the overall run", () => {
  const totals = summarize([{ status: STATUS.pass }, { status: STATUS.fail }]);

  assert.equal(totals.fail, 1);
  assert.equal(totals.ok, false);
});

test("the summary shows how to retry each failure", () => {
  const step = STEPS.find((s) => s.id === "web-build");
  const summary = formatSummary([
    { ...STEPS[0], status: STATUS.pass },
    { ...step, status: STATUS.fail },
  ]);

  assert.match(summary, /FAIL/);
  assert.match(summary, new RegExp(step.hint.slice(0, 12)));
  assert.ok(summary.includes(formatCommand(step)));
});

test("the summary omits the retry section when everything passes", () => {
  const summary = formatSummary(
    STEPS.map((step) => ({ ...step, status: STATUS.pass }))
  );

  assert.ok(!summary.includes("直し方の入口"));
});

test("every step carries a recovery hint", () => {
  for (const step of STEPS) {
    assert.ok(step.hint, `${step.id} is missing a hint`);
    assert.ok(step.group, `${step.id} is missing a group`);
  }
});
