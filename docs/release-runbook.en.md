<a href="release-runbook.ja.md"><kbd>日本語</kbd></a>
<a href="release-runbook.en.md"><kbd>English</kbd></a>

# Desktop Release Runbook v1

This runbook defines the operational steps for safe tag-triggered desktop releases.  
Target workflow: `.github/workflows/release-desktop.yml`.

Related docs:
- RC decision checklist: `docs/release-rc-checklist.en.md`
- RC decision evidence template: `docs/release-evidence-template.en.md`
- RC decision evidence log: `docs/release-evidence-log.en.md`
- Certificate/secrets operations: `docs/certificate-secrets.en.md`

## 0) Prerequisites

- Repository: `gatyoukatyou/cli-commentator`
- Intended branch changes are already pushed
- Required secrets (always):
  - `TAURI_SIGNING_PRIVATE_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- Optional secret (release-permission fallback):
  - `GH_RELEASE_TOKEN` (token with `contents:write`; when unset, workflow falls back to `GITHUB_TOKEN`)
- Optional secrets (required only for Apple signing/notarization mode):
  - `APPLE_CERTIFICATE`
  - `APPLE_CERTIFICATE_PASSWORD`
  - `KEYCHAIN_PASSWORD`
  - `APPLE_ID`
  - `APPLE_PASSWORD`
  - `APPLE_TEAM_ID`

### 0-1. Execution modes

- `Apple secrets present`
  - Runs code signing + notarization
  - Produces release-candidate artifacts
- `Apple secrets missing`
  - Workflow continues in unsigned internal mode
  - Draft Release is generated only for `v0.0.0-smoke.*` tags (internal testing only)
  - Normal `vX.Y.Z` tags fail fast and require signed mode
- `Release write capability not confirmed (missing token or insufficient permission)`
  - For `v0.0.0-smoke.*` tags, workflow continues by uploading Actions artifacts instead of creating a Draft Release
  - Normal `vX.Y.Z` tags fail fast and require release-creation permissions

## 0.5) Latest Dry-Run Record (2026-02-13)

- Tag: `v0.0.0-smoke.5`
- Workflow run: `https://github.com/gatyoukatyou/cli-commentator/actions/runs/21986062140`
- Outcome:
  - `Verify updater key configuration` passed on both arm64/x64 jobs
  - `plugins.updater.pubkey` key id matched signing private key id: `0EDB9F95DB53F9FA`
  - At that time, run stopped at `Validate Apple signing/notarization secrets`
  - Missing secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
  - As of 2026-02-13 workflow update, missing Apple secrets trigger unsigned internal fallback instead of hard stop

## 0.6) Latest Local Preflight (2026-02-18) + Smoke Revalidation (2026-02-19)

- Target commit: `35262de` (`main`)
- Outcome:
  - `pnpm verify:updater`: Pass (config-only, key id `0EDB9F95DB53F9FA`)
  - `pnpm -C apps/web lint` / `pnpm -C apps/web build`: Pass
  - `CLI_COMMENTATOR_FORCE_NO_PTY=1 pnpm -C apps/server test`: Pass
  - `failure_regression` equivalent suite: 34/34 Pass (`artifacts/failure-regression/summary.md`)
  - `pnpm smoke:desktop-distribution`: Pass
  - `pnpm verify:apple-signing`: Fail (missing `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`)
- Decision:
  - Local preflight: Go
  - Signed distribution readiness: No-Go (`#138` unresolved, no signed `release-desktop` run evidence yet)
- Additional smoke runs:
  - `v0.0.0-smoke.20260218-01`:
    - run: `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22138523276`
    - outcome: Failure (missing `binaries/node-aarch64-apple-darwin` / `binaries/node-x86_64-apple-darwin`)
  - `v0.0.0-smoke.20260218-02`:
    - run: `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22138744883`
    - outcome: Cancelled
    - detail: arm64 build completed bundling, then failed at Draft Release creation with `Resource not accessible by integration`
    - detail: x64 job did not start because `macos-13-us-default` is unsupported
  - `v0.0.0-smoke.20260218-03`:
    - run: `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22139085837`
    - outcome: Failure
    - detail: both arm64 and x64 jobs completed bundling successfully
    - detail: both jobs failed when creating Draft Release with `Resource not accessible by integration`
  - `v0.0.0-smoke.20260219-test`:
    - run: `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22185152032`
    - outcome: Success
    - detail: `Verify release publish permissions` passed on both arm64/x64 jobs (after PR #186 preflight rollout)
    - detail: with `GH_RELEASE_TOKEN` still missing, Draft Release was skipped and token fallback artifacts were uploaded (`smoke-bundle-aarch64-apple-darwin` / `smoke-bundle-x86_64-apple-darwin`)

## 0.7) Latest Smoke Run (2026-02-20: after configuring GH release token)

- Tag: `v0.0.0-smoke.20260220-211548`
- Workflow run: `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22223734792`
- Outcome:
  - `Verify release publish permissions`: Pass on both arm64/x64 jobs
  - token source: `gh_release_token` (`GH_RELEASE_TOKEN` path)
  - `Build and draft release (unsigned internal)`: Pass on both arm64/x64 jobs
  - token fallback steps (`Resolve fallback target triple` / `Build smoke artifacts without Draft Release` / `Upload smoke artifacts`) were skipped
  - Draft Release: `isDraft=true`, `isPrerelease=true`, `tagName=v0.0.0-smoke.20260220-211548`
  - Draft Release assets: `latest.json` / `.app.tar.gz` / `.sig` / `.dmg` generated for arm64/x64
- Notes:
  - `gh secret list --repo gatyoukatyou/cli-commentator` shows Apple secrets are present except `APPLE_CERTIFICATE`
  - signed/notarized distribution remains blocked by `#138`

## 1) Pre-release checks (required)

### 1-1. Local verification

Recommended one-command wrapper:

```bash
pnpm verify:internal-release
```

Run individual commands if needed:

```bash
pnpm install
pnpm verify:updater
GH_RELEASE_TOKEN=<token> pnpm verify:release-token --repo gatyoukatyou/cli-commentator
pnpm verify:apple-signing:detect
pnpm -C apps/web lint
pnpm -C apps/web build
CLI_COMMENTATOR_FORCE_NO_PTY=1 pnpm -C apps/server test
pnpm prepare:desktop-sidecar
pnpm -C apps/desktop tauri:build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
pnpm smoke:desktop-distribution
```

Notes:
- `verify:internal-release` is a wrapper that executes the unsigned-internal runbook checklist in order.
- If `GH_RELEASE_TOKEN` is not set, it automatically uses `gh auth token`.
- With `CLI_COMMENTATOR_FORCE_NO_PTY=1`, node-pty-required coverage (`windows-fallback-integration` restart `ptyError` scenario) is intentionally skipped.
- `verify:release-token` prefers `GH_RELEASE_TOKEN` and falls back to `GITHUB_TOKEN`, then probes release-write capability via GitHub API.
- If local `GITHUB_TOKEN` is unavailable, export `GH_RELEASE_TOKEN` temporarily before running the check.
- `verify:apple-signing:detect` reports missing Apple secrets and exits 0 (useful for unsigned-internal operation).
- Before signed distribution, always run `pnpm verify:apple-signing` (require mode) and make it pass.

### 1-2. What `verify:updater` validates

- Validates `plugins.updater.pubkey` structure in `apps/desktop/src-tauri/tauri.conf.json`
- If `TAURI_SIGNING_PRIVATE_KEY` is present, runs a signing smoke check and verifies key-id pairing

## 2) Standard release flow (happy path)

1. Bump version in `apps/desktop/src-tauri/tauri.conf.json`
2. Commit and push
3. Create and push tag
   - `git tag -a vX.Y.Z -m "vX.Y.Z"`
   - `git push origin vX.Y.Z`
4. Confirm `release-desktop` workflow passes
5. Validate Draft Release assets
   - signed mode: signed/notarized artifacts
   - unsigned mode: internal-test artifacts (Gatekeeper warning expected)
6. Publish draft when validation is complete

## 3) Failure recovery playbook

### Case A: `Verify updater key configuration` fails

Symptoms:
- Workflow stops in `verify-updater-config.mjs`

Actions:
1. Verify `plugins.updater.pubkey` is valid base64 and minisign format
2. Verify `TAURI_SIGNING_PRIVATE_KEY` and password secrets
3. Reproduce locally with `pnpm verify:updater`
4. Fix, then re-run with a corrected tag

### Case B: Apple secrets missing, workflow falls back to unsigned internal mode

Symptoms:
- Log shows `Apple signing/notarization disabled`
- Workflow continues with `Build and draft release (unsigned internal)`

Actions:
1. For production-ready distribution, set `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `KEYCHAIN_PASSWORD`
2. Set `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`
3. Export values in the same shell and run `pnpm verify:apple-signing` (require mode) for format validation
4. Re-run with a new tag and confirm signed mode
5. If budget is not available yet, run `pnpm verify:apple-signing:detect` to confirm missing-secret state only
6. If budget is not available yet, continue using unsigned mode for internal validation
   - unsigned mode is allowed only with `v0.0.0-smoke.*` tags

### Case C: `tauri-action` build/signing fails

Symptoms:
- `Build and draft release` step fails

Actions:
1. Identify failure point in Actions logs (signing/build/upload)
2. Re-check secrets and dependency state (including lockfile)
   - Focus first on `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `KEYCHAIN_PASSWORD`
3. If needed, recreate tag after fixes
   - `git tag -d vX.Y.Z`
   - `git push origin :refs/tags/vX.Y.Z`
   - Create/push tag again

### Case D: Draft Release missing artifacts

Symptoms:
- Missing `latest.json` or expected platform artifacts

Actions:
1. Check workflow matrix and `bundle.targets`
2. Fix and re-run from corrected tag
3. Delete incomplete draft and regenerate

### Case E: notarization failure

Symptoms:
- Build finishes but notarization step fails

Actions:
1. Re-check `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`
2. Verify Apple account state (for example expired app-specific password)
3. Update secrets if needed and rerun with corrected tag

### Case F: `Resource not accessible by integration` while creating release

Symptoms:
- `tauri-action` fails during Draft Release creation with `Resource not accessible by integration`

Actions:
1. Verify repository workflow permissions are set to `Read and write`
2. Verify job-level `contents: write` is active
3. Run `GH_RELEASE_TOKEN=<token> pnpm verify:release-token --repo gatyoukatyou/cli-commentator` to preflight release-write capability
4. Configure `GH_RELEASE_TOKEN` (`contents:write`) and verify workflow step `Verify release publish permissions` reports `write_capable=true`
5. If smoke tags run without confirmed write access, verify `smoke-bundle-<target>` artifacts are uploaded
6. Check org/repo rulesets for restrictions on release creation APIs
7. After permission fixes, rerun with a new tag

### Case G: matrix runner label is unsupported

Symptoms:
- Job annotation shows `The configuration '<runner-label>' is not supported`

Actions:
1. Replace the runner label with one supported by the repository
2. Re-check matrix platform/target mapping
3. Rerun with a new tag after the workflow update

## 4) Rollback policy

### Before publish (preferred)

- Keep release as draft and discard bad artifacts
- Delete tag and recreate a corrected release tag

### After publish

1. Mark the problematic release clearly in GitHub release notes/title
2. Prepare patched release `vX.Y.(Z+1)` as fast as possible
3. Notify users to defer update until patched version is available

## 5) Minimal audit trail

- Release tag
- Workflow run URL
- Release approver
- Root cause + remediation notes (if incident occurred)
- RC decision evidence record (format from `docs/release-evidence-template.en.md`)
- `failure_regression` summary (`failure-regression-logs/summary.md`)

Keeping these five points makes later incidents much easier to reproduce and fix.

## 6) Reference: state-transition log format

### 6-1) Desktop lifecycle

Desktop server lifecycle transitions are emitted to stderr in this format:

```text
[desktop/server-event] {"ts":1739394000123,"trigger":"begin_start_transition","from":"stopped","to":"starting","operation_id":12,"pid":null,"port":8787,"detail":null}
```

Key fields:
- `trigger`: transition source handler
- `from` / `to`: lifecycle state transition
- `operation_id`: start/stop operation identifier
- `detail`: optional context (`exit_code`, failure detail, etc.)

### 6-2) Server runtime (`apps/server`)

Server runtime transitions are emitted to stdout/stderr in this format:

```text
[server/state-event] {"ts":1739470000123,"trigger":"restart_fallback_file","from":"restarting","to":"file_running","inputMode":"file","profileId":"profile-1","detail":"fallback_reason=activated"}
```

Key fields:
- `trigger`: transition source handler (for example: `bootstrap`, `restart_begin`, `cleanup_complete`)
- `from` / `to`: server runtime state transition
- `inputMode`: active input mode (`pty` / `file`) at transition time
- `profileId`: target profile id (`null` if not applicable)
- `detail`: optional context (fallback reason, exit code, error summary, etc.)

### 6-3) Timeline triage commands (operations)

```bash
# 1) Extract only server runtime transitions
rg '^\[server/state-event\] ' <log-file> \
  | sed 's/^\[server\/state-event\] //'

# 2) Extract only desktop lifecycle transitions
rg '^\[desktop/server-event\] ' <log-file> \
  | sed 's/^\[desktop\/server-event\] //'

# 3) Inspect startup failures and transitions together
rg '^\[(startup/failure|server/state-event|desktop/server-event)\] ' <log-file>
```

Notes:
- Use `<log-file>` as either an Actions artifact log (for example: `artifacts/failure-regression/console.log`) or local stdout/stderr capture
- For incident triage, start with `startup/failure` and then correlate `server/state-event` and `desktop/server-event` in timeline order
