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
- Execution mode: unsigned-internal (Apple secrets missing)
- Artifact check:
  - `latest.json`: Missing (workflow failed before release creation)
  - `.app.tar.gz`: Partial (generated in `smoke.02` arm64 job)
  - `.sig`: Partial (generated in `smoke.02` arm64 job)
  - `.dmg`: Partial (generated in `smoke.02` arm64 job)

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
- Accepted risk: x64 artifacts and Draft Release creation remain incomplete (arm64 build only)
- Blocking issue:
  - `#138` Apple certificate configuration (Apple secrets missing)
  - `release-desktop` x64 matrix runner configuration (`macos-13-us-default` unsupported)
  - GitHub release creation permission (`Resource not accessible by integration`)

### Follow-up
- [ ] Configure `APPLE_*` secrets and make `pnpm verify:apple-signing` pass
- [ ] Move x64 runner config to a supported image and rerun `release-desktop`
- [ ] Resolve `Resource not accessible by integration` permission requirement for draft release creation
- Owner: maintainers
- Due: 2026-02-19
