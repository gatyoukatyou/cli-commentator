<a href="release-evidence-log.ja.md"><kbd>日本語</kbd></a>
<a href="release-evidence-log.en.md"><kbd>English</kbd></a>

# v0.2.0 RC Decision Evidence Log

This document is the operational record log built from `docs/release-evidence-template.en.md`.  
Append new candidate records at the end to keep a traceable Go/No-Go history.

Related docs:
- Evidence template: `docs/release-evidence-template.en.md`
- RC checklist: `docs/release-rc-checklist.en.md`
- Desktop Release Runbook: `docs/release-runbook.en.md`

## RC Evidence Record: 2026-02-13

### Metadata
- Candidate: `v0.0.0-smoke.5` (internal dry-run)
- Commit: `main@2026-02-13`
- Reviewer: maintainers
- Decision Meeting: `2026-02-13`
- Decision: Conditional Go (internal verification only)

### CI Evidence
- Required checks run: `release-desktop` dry-run (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/21986062140`)
- `desktop_distribution_smoke`: Pass (artifact verification in the same run)
- `failure_regression`: N/A (not introduced at that time)
- `failure_regression` summary artifact: N/A

### Release Workflow Evidence
- `release-desktop` run: `https://github.com/gatyoukatyou/cli-commentator/actions/runs/21986062140`
- Execution mode: unsigned-internal (Apple secrets missing)
- Artifact check:
  - `latest.json`: Present
  - `.app.tar.gz`: Present
  - `.sig`: Present
  - `.dmg`: Present

### Runtime/Recovery Evidence
- Desktop lifecycle event sample (`[desktop/server-event]`): N/A (workflow-level dry-run)
- Server state event sample (`[server/state-event]`): N/A (workflow-level dry-run)
- Startup failure classification checked: Yes (see section 0.5 in `docs/release-runbook.en.md`)

### Cross-Platform Smoke Evidence
- macOS arm64: Pass (workflow artifacts)
- macOS x64: Pass (workflow artifacts)
- Windows fallback path: Skip

### Risks and Exceptions
- Open P0/P1: None known at this record point
- Accepted risk: production signed distribution was blocked by missing Apple signing secrets
- Blocking issue: `#138` Apple certificate configuration

### Follow-up
- [x] Add Apple signing secrets preflight validation in CI (PR #166)
- [x] Add RC decision evidence templates (PR #178)
- Owner: maintainers
- Due: 2026-02-17

## RC Evidence Record: 2026-02-18

### Metadata
- Candidate: `preflight-2026-02-18` (local verification)
- Commit: `35262de` (`main`)
- Reviewer: Codex
- Decision Meeting: `2026-02-18`
- Decision: Conditional Go (local preflight only)

### CI Evidence
- Required checks run: local preflight (`pnpm verify:updater`, `pnpm -C apps/web lint`, `pnpm -C apps/web build`, `CLI_COMMENTATOR_FORCE_NO_PTY=1 pnpm -C apps/server test`)
- `desktop_distribution_smoke`: Pass (`pnpm smoke:desktop-distribution`, local)
- `failure_regression`: Pass (local vitest suite)
- `failure_regression` summary artifact: `artifacts/failure-regression/summary.md` (local workspace)

### Release Workflow Evidence
- `release-desktop` run:
  - `v0.0.0-smoke.20260218-01` → `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22138523276` (Failure)
  - `v0.0.0-smoke.20260218-02` → `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22138744883` (Cancelled)
  - `v0.0.0-smoke.20260218-03` → `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22139085837` (Failure)
- Execution mode: unsigned-internal (Apple secrets missing)
- Artifact check:
  - `latest.json`: Missing (workflow failed before release creation)
  - `.app.tar.gz`: Present (generated in both arm64/x64 jobs on `smoke.03`)
  - `.sig`: Present (generated in both arm64/x64 jobs on `smoke.03`)
  - `.dmg`: Present (generated in both arm64/x64 jobs on `smoke.03`)

### Runtime/Recovery Evidence
- Desktop lifecycle event sample (`[desktop/server-event]`): local `pnpm smoke:desktop-distribution` confirmed `/healthz` + `comment_ok`
- Server state event sample (`[server/state-event]`): local `failure_regression` run included `state-event` tests
- Startup failure classification checked: Yes (`src/tests/startup.failure.test.ts`)

### Cross-Platform Smoke Evidence
- macOS arm64: Pass (local `.app` runtime smoke)
- macOS x64: Skip (single-host local verification)
- Windows fallback path: Pass (`src/tests/windows-fallback-integration.test.ts` in local regression suite)

### Risks and Exceptions
- Open P0/P1: None known at this record point
- Accepted risk: workflow still stops before Draft Release creation, leaving `latest.json` missing
- Blocking issue:
  - `#138` Apple certificate configuration (Apple secrets missing)
  - GitHub release creation permission (`Resource not accessible by integration`)

### Follow-up
- [ ] Configure `APPLE_*` secrets and make `pnpm verify:apple-signing` pass
- [x] Move x64 runner config to a supported image (`macos-15-intel`) and rerun `release-desktop`
- [ ] Resolve `Resource not accessible by integration` permission requirement for draft release creation
- Owner: maintainers
- Due: 2026-02-19

## RC Evidence Record: 2026-02-18 (token fallback validation)

### Metadata
- Candidate: `v0.0.0-smoke.20260218-06` (workflow smoke rerun)
- Commit: `bde390b` (`fix/release-token-fallback-smoke-artifacts`)
- Reviewer: Codex
- Decision Meeting: `2026-02-18`
- Decision: Conditional Go (token fallback path only)

### CI Evidence
- Required checks run: PR #185 checks (`https://github.com/gatyoukatyou/cli-commentator/pull/185`)
- `publish-tauri`:
  - arm64: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22141743350/job/64007523325`)
  - x64: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22141743350/job/64007523482`)
- `desktop_distribution_smoke`: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22141738456/job/64007505359`)
- `failure_regression`: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22141738456/job/64007505332`)

### Release Workflow Evidence
- `release-desktop` run:
  - `v0.0.0-smoke.20260218-04` → `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22141337857` (Failure)
  - `v0.0.0-smoke.20260218-05` → `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22141678791` (Cancelled, superseded by smoke.06)
  - `v0.0.0-smoke.20260218-06` → `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22141743350` (Success)
- Execution mode: token fallback (`GH_RELEASE_TOKEN` not configured)
- Artifact check:
  - `latest.json`: Missing (Draft Release is intentionally skipped in fallback mode)
  - `smoke-bundle-aarch64-apple-darwin`: Present (artifact id `5556004921`)
  - `smoke-bundle-x86_64-apple-darwin`: Present (artifact id `5556019968`)
  - `.app.tar.gz` / `.sig` / `.dmg`: Present (included in both uploaded artifacts)

### Runtime/Recovery Evidence
- Desktop lifecycle event sample (`[desktop/server-event]`): runtime smoke continued to pass via `desktop_distribution_smoke`
- Server state event sample (`[server/state-event]`): state-event related regression coverage continued via `failure_regression`
- Startup failure classification checked: Yes (continued in existing regression suite)

### Cross-Platform Smoke Evidence
- macOS arm64: Pass (`smoke-bundle-aarch64-apple-darwin`)
- macOS x64: Pass (`smoke-bundle-x86_64-apple-darwin`)
- Windows fallback path: Pass (continued in `failure_regression`)

### Risks and Exceptions
- Open P0/P1: None known at this record point
- Accepted risk: no Draft Release is created when `GH_RELEASE_TOKEN` is missing
- Blocking issue:
  - `#138` Apple certificate configuration (Apple secrets not configured)
  - Missing `GH_RELEASE_TOKEN` for release creation path

### Follow-up
- [ ] Configure `GH_RELEASE_TOKEN` (`contents:write`) and restore Draft Release creation path
- [ ] Configure `APPLE_*` secrets and make `pnpm verify:apple-signing` pass
- [x] Validate token fallback smoke artifact path (`smoke.06`)
- Owner: maintainers
- Due: 2026-02-19

## RC Evidence Record: 2026-02-20 (release permission preflight rollout)

### Metadata
- Candidate: `v0.0.0-smoke.20260219-test` (workflow smoke rerun)
- Commit: `559f781` (`fix/release-write-permission-preflight`)
- Reviewer: Codex
- Decision Meeting: `2026-02-20`
- Decision: Conditional Go (permission preflight + token fallback)

### CI Evidence
- Required checks run: PR #186 checks (`https://github.com/gatyoukatyou/cli-commentator/pull/186/checks`)
- `publish-tauri`:
  - arm64: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22185152032/job/64156687334`)
  - x64: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22185152032/job/64156687358`)
- `desktop_distribution_smoke`: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22185057157/job/64156345943`)
- `failure_regression`: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22185057157/job/64156345960`)

### Release Workflow Evidence
- `release-desktop` run:
  - `v0.0.0-smoke.20260219-test` → `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22185152032` (Success)
- Execution mode: token fallback (`GH_RELEASE_TOKEN` not configured)
- Release permission preflight:
  - `Verify release publish permissions`: Pass on both arm64/x64 jobs
  - `Build and draft release (signed + notarized)` / `Build and draft release (unsigned internal)`: Skip (token fallback path)
- Artifact check:
  - `latest.json`: Missing (Draft Release is intentionally skipped in fallback mode)
  - `smoke-bundle-aarch64-apple-darwin`: Present (artifact id `5573817931`)
  - `smoke-bundle-x86_64-apple-darwin`: Present (artifact id `5573870598`)
  - `.app.tar.gz` / `.sig` / `.dmg`: Present (included in both uploaded artifacts)

### Runtime/Recovery Evidence
- Desktop lifecycle event sample (`[desktop/server-event]`): runtime smoke continued to pass via `desktop_distribution_smoke`
- Server state event sample (`[server/state-event]`): state-event related regression coverage continued via `failure_regression`
- Startup failure classification checked: Yes (continued in existing regression suite)

### Cross-Platform Smoke Evidence
- macOS arm64: Pass (`smoke-bundle-aarch64-apple-darwin`)
- macOS x64: Pass (`smoke-bundle-x86_64-apple-darwin`)
- Windows fallback path: Pass (`test_windows` check)

### Risks and Exceptions
- Open P0/P1: None known at this record point
- Accepted risk: no Draft Release is created when `GH_RELEASE_TOKEN` is missing
- Blocking issue:
  - `#138` Apple certificate configuration (`APPLE_CERTIFICATE` secret is still missing)
  - Missing `GH_RELEASE_TOKEN` for release creation path

### Follow-up
- [x] Add release write-permission preflight to workflow (PR #186, merge commit `60576eb`)
- [ ] Configure `GH_RELEASE_TOKEN` (`contents:write`) and confirm `write_capable=true` in `Verify release publish permissions`
- [ ] Configure `APPLE_CERTIFICATE` and make `pnpm verify:apple-signing` pass
- Owner: maintainers
- Due: 2026-02-23

## RC Evidence Record: 2026-02-20 (GH release token configured)

### Metadata
- Candidate: `v0.0.0-smoke.20260220-211548` (workflow smoke rerun)
- Commit: `878f833` (`docs: record release preflight rollout evidence (#187)`)
- Reviewer: Codex
- Decision Meeting: `2026-02-20`
- Decision: Conditional Go (unsigned internal + Draft Release)

### CI Evidence
- Required checks run: `release-desktop` (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22223734792`)
- `publish-tauri`:
  - arm64: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22223734792/job/64285137016`)
  - x64: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22223734792/job/64285136990`)
- `desktop_distribution_smoke`: N/A (tag workflow scope)
- `failure_regression`: N/A (tag workflow scope)

### Release Workflow Evidence
- `release-desktop` run:
  - `v0.0.0-smoke.20260220-211548` → `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22223734792` (Success)
- Execution mode: unsigned internal (Apple secrets missing)
- Release permission preflight:
  - `Verify release publish permissions`: Pass on both arm64/x64 jobs
  - token source: `gh_release_token`
  - `Build and draft release (unsigned internal)`: Pass on both arm64/x64 jobs
  - token fallback steps (24-26): Skip
- Artifact check:
  - `latest.json`: Present (generated in Draft Release)
  - `.app.tar.gz` / `.sig` / `.dmg`: Present (arm64/x64)
  - Draft Release metadata: `isDraft=true`, `isPrerelease=true`, `tagName=v0.0.0-smoke.20260220-211548`

### Runtime/Recovery Evidence
- Desktop lifecycle event sample (`[desktop/server-event]`): N/A (tag workflow scope)
- Server state event sample (`[server/state-event]`): N/A (tag workflow scope)
- Startup failure classification checked: Yes (workflow test steps passed)

### Cross-Platform Smoke Evidence
- macOS arm64: Pass (Draft Release assets)
- macOS x64: Pass (Draft Release assets)
- Windows fallback path: N/A

### Risks and Exceptions
- Open P0/P1: None known at this record point
- Accepted risk: signed/notarized distribution is still pending until `#138` is resolved
- Blocking issue:
  - `#138` Apple certificate configuration (`APPLE_CERTIFICATE` is still missing in repo secrets)

### Follow-up
- [x] Configure `GH_RELEASE_TOKEN` (`contents:write`) and confirm `write_capable=true` in `Verify release publish permissions`
- [ ] Configure `APPLE_CERTIFICATE` and make `pnpm verify:apple-signing` pass
- [ ] While paid Apple certificate setup is deferred, continue unsigned internal validation with `v0.0.0-smoke.*`
- Owner: maintainers
- Due: 2026-02-27

## RC Evidence Record: 2026-03-14 (Sprint 16 startup recovery alignment batch)

### Metadata
- Candidate: `main` after PR #219
- Commit: `82388a0` (`fix(web): reduce input chatter and tts lag (#219)`)
- Reviewer: Codex
- Decision Meeting: `2026-03-14`
- Decision: Conditional Go (startup recovery alignment + CI green)

### CI Evidence
- Required checks run:
  - PR #213 checks (`https://github.com/gatyoukatyou/cli-commentator/pull/213/checks`)
  - PR #217 checks (`https://github.com/gatyoukatyou/cli-commentator/pull/217/checks`)
  - PR #218 checks (`https://github.com/gatyoukatyou/cli-commentator/pull/218/checks`)
  - PR #219 checks (`https://github.com/gatyoukatyou/cli-commentator/pull/219/checks`)
- Core checks:
  - `failure_regression`: Pass (#213 / #217 / #218 / #219)
  - `desktop_distribution_smoke`: Pass (#213 / #217 / #218 / #219)
  - `desktop_check`: Pass (#213 / #217 / #218 / #219)
  - `test`: Pass (#213 / #217 / #218 / #219)
  - `test_windows`: Pass (#213 / #217 / #218 / #219)
  - `docs_drift_guard`: Pass (#213 / #217 / #218 / #219)

### Runtime/Recovery Evidence
- PR #213 (merge commit `e62109b`):
  - aligned `apps/server` `[startup/failure]`, Desktop startup errors, Web recovery buckets, and distribution negative-path smoke end-to-end
  - `desktop_distribution_smoke` / `failure_regression` / `desktop_check` / `test_windows` all passed
- PR #217 (merge commit `077fb2e`):
  - added recovery guidance test coverage for known categories (`sidecar_manifest_parse`, `sidecar_server_root_missing`, `inspect_before_stop`, `process_state`, `missing_process_handle`)
- PR #218 (merge commit `9e0cea1`):
  - suppressed Codex progress-only fragments from commentary
  - switched filtering to runtime source-aware handling to avoid meaningless "started/progress" commentary cards
- PR #219 (merge commit `82388a0`):
  - suppressed duplicate terminal input around IME/paste cases
  - shortened TTS batching delay (normal `900ms -> 320ms`, `done/error` `120ms`)
  - strengthened explanation prompts so commentary more consistently answers "what is being checked" and "what can be inferred next"
- Startup failure classification checked: Yes (PR #213 + `failure_regression`)
- Recovery guidance known categories checked: Yes (PR #217 + `apps/web/src/lib/recovery.test.ts`)
- Commentary noise suppression checked: Yes (PR #218 + `apps/server/src/__tests__/extract.test.ts` / `apps/server/src/tests/comment.errors.test.ts`)
- Input/TTS UX regression checked: Yes (PR #219 + `apps/web` test/build/lint)

### Cross-Platform Smoke Evidence
- macOS desktop distribution smoke: Pass (PR #213 / #217 / #218 / #219)
- Windows desktop cargo/test path: Pass (`desktop_check` on PR #213 / #217 / #218 / #219)
- Windows server/web path: Pass (`test_windows` on PR #213 / #217 / #218 / #219)
- Local note:
  - during early implementation, the local environment did not have the Rust toolchain, so bundle build / local smoke was temporarily not reproducible there
  - final evidence relies on GitHub Actions `desktop_distribution_smoke` / `desktop_check` passing

### Risks and Exceptions
- Open P0/P1: None known at this record point
- Accepted risk:
  - signed/notarized release readiness remains blocked by `#138`
  - clean internal physical-machine evidence is tracked separately from CI evidence
- Remaining gap:
  - `needs manual review` remains as the intentional fallback for unknown or unstructured failures, not as a known-category gap on main
  - deeper `spawn` sub-classification (`spawn_node_missing`, etc.) remains a next-sprint candidate unless concrete examples prove the current buckets insufficient

### Follow-up
- [x] Record Sprint 16 startup recovery alignment and UX evidence in the evidence log
- [x] Re-audit `#215` and record the current fallback / `spawn` defer decision
- [x] Update ROADMAP / roadmap-issues `done / remaining / blocked` as `#214`
- [ ] Resolve `#138` and resume signed/notarized release readiness work
- Owner: maintainers
- Due: 2026-03-18

## RC Evidence Record: 2026-05-09 (unsigned distribution hardening smoke)

### Metadata
- Candidate: `v0.0.0-smoke.20260509-135214` (workflow smoke rerun)
- Commit: `485d0f8` (`ci: harden unsigned desktop distribution smoke`, PR #252)
- Reviewer: Codex
- Decision Meeting: `2026-05-09`
- Decision: Conditional Go (unsigned internal distribution path)

### CI Evidence
- Required checks run:
  - PR #252 checks (`https://github.com/gatyoukatyou/cli-commentator/pull/252/checks`)
  - `release-desktop` smoke (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/25592176981`)
- Core checks on PR #252:
  - `actionlint`: Pass
  - `docs_drift_guard`: Pass
  - `test`: Pass
  - `test_windows`: Pass
  - `desktop_check`: Pass
  - `desktop_distribution_smoke`: Pass
  - `failure_regression`: Pass
  - CodeQL: Pass

### Release Workflow Evidence
- `release-desktop` run:
  - `v0.0.0-smoke.20260509-135214` -> `https://github.com/gatyoukatyou/cli-commentator/actions/runs/25592176981` (Success)
- Execution mode: unsigned-internal (`APPLE_CERTIFICATE` still missing in repo secrets)
- Release permission preflight:
  - `Verify release publish permissions`: Pass via `GH_RELEASE_TOKEN`
  - `Build and draft release (unsigned internal)`: Pass on arm64 and x64 jobs
  - `Build and draft release (signed + notarized)`: Skip as expected
- Draft Release metadata:
  - `name=CLI Commentator v0.0.0-smoke.20260509-135214 (Unsigned Smoke)`
  - `isDraft=true`
  - `isPrerelease=true`
  - `tagName=v0.0.0-smoke.20260509-135214`
  - Body states this is an unsigned smoke and Gatekeeper warnings are expected
- Artifact check:
  - `latest.json`: Present (2.7 KB)
  - `CLI.Commentator_0.1.0_aarch64.dmg`: Present (81,443,191 bytes)
  - `CLI.Commentator_0.1.0_x64.dmg`: Present (82,930,106 bytes)
  - `CLI.Commentator_aarch64.app.tar.gz`: Present (82,841,422 bytes)
  - `CLI.Commentator_x64.app.tar.gz`: Present (84,126,701 bytes)
  - `CLI.Commentator_aarch64.app.tar.gz.sig`: Present (416 bytes)
  - `CLI.Commentator_x64.app.tar.gz.sig`: Present (416 bytes)
  - `scripts/verify-desktop-bundle-artifacts.mjs --require dmg --require app-tar-gz --require sig`: Pass against downloaded Draft Release assets

### Runtime/Recovery Evidence
- Desktop lifecycle event sample (`[desktop/server-event]`): N/A (tag workflow scope)
- Server state event sample (`[server/state-event]`): N/A (tag workflow scope)
- Startup failure classification checked: Yes (PR #252 CI retained `desktop_distribution_smoke` / `failure_regression`)
- In-app diagnostics checked by CI build: PR #252 added Desktop Server panel entries for version, platform, logs path, and config path

### Cross-Platform Smoke Evidence
- macOS arm64: Pass (Draft Release assets + verifier)
- macOS x64: Pass (Draft Release assets + verifier)
- Windows fallback path: Pass (`test_windows` on PR #252)
- Linux install path: Documented in runbook; no Linux desktop asset is produced by this macOS-only release workflow

### Risks and Exceptions
- Open P0/P1: None known at this record point
- Accepted risk:
  - this record validates the unsigned internal path only
  - signed/notarized release readiness remains blocked by `#138`
- Blocking issue:
  - `#138` Apple certificate configuration (`APPLE_CERTIFICATE` is still missing in repo secrets)

### Follow-up
- [x] Merge unsigned distribution hardening (PR #252)
- [x] Run an unsigned `v0.0.0-smoke.*` after PR #252 reached `main`
- [x] Confirm Draft Release label/body/prerelease state identifies `Unsigned Smoke`
- [x] Confirm downloaded Draft Release assets pass bundle verification
- [ ] Configure `APPLE_CERTIFICATE` and rerun signed/notarized smoke when the Developer ID `.p12` is available
- Owner: maintainers
- Due: 2026-05-16
