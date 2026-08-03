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
  - For `v0.0.0-smoke.*` tags, still runs the signed/notarized path but marks the Draft Release as prerelease and keeps it for internal evidence only
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

## 0.8) Current #138 Signing Readiness Snapshot (2026-05-09)

- Repository secrets:
  - Present: `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
  - Missing: `APPLE_CERTIFICATE`
- Local shell checks:
  - `pnpm verify:apple-signing:detect` only inspects environment variables in the current shell, not repository secret names.
  - Therefore, a local run can report all Apple secrets as missing even when repository secrets already exist.
- Remaining blocker:
  - Issue/export a Developer ID Application certificate with its private key as `.p12`
  - Base64-encode the `.p12` and register it as `APPLE_CERTIFICATE`
  - Rotate `APPLE_CERTIFICATE_PASSWORD` at the same time if the `.p12` export password changes

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
- `pnpm smoke:desktop-distribution` now checks both the healthy bundle path and a broken `.app` copy that must fail with `[sidecar_server_entry_missing]`.
- `verify:release-token` prefers `GH_RELEASE_TOKEN` and falls back to `GITHUB_TOKEN`, then probes release-write capability via GitHub API.
- If local `GITHUB_TOKEN` is unavailable, export `GH_RELEASE_TOKEN` temporarily before running the check.
- `verify:apple-signing:detect` reports missing Apple secrets and exits 0 (useful for unsigned-internal operation).
- Before signed distribution, always run `pnpm verify:apple-signing` (require mode) and make it pass.

### 1-2. What `verify:updater` validates

- Validates `plugins.updater.pubkey` structure in `apps/desktop/src-tauri/tauri.conf.json`
- If `TAURI_SIGNING_PRIVATE_KEY` is present, runs a signing smoke check and verifies key-id pairing

### 1-3. Updater contract verification

Use this check whenever a release candidate produces updater artifacts:

1. Confirm `pnpm verify:updater` passes before tagging.
2. Confirm the Draft Release includes:
   - `latest.json`
   - one `.app.tar.gz` per macOS architecture
   - matching `.app.tar.gz.sig` files
   - `.dmg` installers for human installation
3. Run the bundle verifier against downloaded release assets:
   - `pnpm verify:desktop-bundle-artifacts <assets-dir> --require dmg --require app-tar-gz --require sig`
4. Inspect `latest.json`:
   - platform keys: `darwin-aarch64`, `darwin-aarch64-app`, `darwin-x86_64`, `darwin-x86_64-app`
   - each `url` basename points to a present `.app.tar.gz`
   - each `signature` is non-empty
5. From an installed desktop app, open Desktop Server panel and click `Check updates`.
6. If update check fails, click `Copy Debug bundle` and attach it to the release evidence or issue comment.

Current policy: update checks are manual from the Desktop Server panel. Do not treat the absence of startup-time automatic update checks as a release blocker.

## 2) Standard release flow (happy path)

1. Bump these desktop versions to the same `X.Y.Z` and verify they match:
   - `apps/desktop/package.json`
   - `apps/desktop/src-tauri/Cargo.toml`
   - `cli-commentator-desktop` in `apps/desktop/src-tauri/Cargo.lock`
   - `apps/desktop/src-tauri/tauri.conf.json`
2. Commit and push
3. Create and push tag
   - `git tag -a vX.Y.Z -m "vX.Y.Z"`
   - `git push origin vX.Y.Z`
4. Confirm `release-desktop` workflow passes
5. Validate Draft Release assets
   - signed mode: signed/notarized artifacts
   - signed smoke mode (`v0.0.0-smoke.*` with Apple secrets present): signed/notarized artifacts, `isDraft=true`, `isPrerelease=true`
   - unsigned mode: internal-test artifacts (`Unsigned Smoke`, `isDraft=true`, `isPrerelease=true`; Gatekeeper warning expected)
   - updater contract: `latest.json` resolves to present `.app.tar.gz` assets with non-empty signatures
6. Publish draft when validation is complete

## 2.5) Unsigned Install Cheats

Current `release-desktop` smoke automation publishes macOS artifacts (`.dmg`, `.app.tar.gz`, `.sig`) from the macOS matrix. Use the Windows/Linux notes when equivalent artifacts are produced by a local build or a future release matrix.

### macOS unsigned install

1. Download the `.dmg` from the `Unsigned Smoke` Draft Release.
2. Open the `.dmg`.
3. Drag `CLI Commentator.app` into `Applications`.
4. Launch from Finder.

If macOS blocks first launch:

1. In Finder, right-click `CLI Commentator.app`.
2. Choose `Open`.
3. Confirm the unsigned-app warning.
4. If the button is still blocked, open `System Settings` -> `Privacy & Security`, then choose `Open Anyway` for CLI Commentator.

Common warnings:

- `cannot be opened because the developer cannot be verified`: expected for unsigned smoke builds; use Finder right-click -> `Open`.
- `was blocked from use because it is not from an identified developer`: expected for unsigned smoke builds; use `Privacy & Security` -> `Open Anyway`.
- `is damaged and can't be opened`: remove quarantine only for an internal smoke artifact that came from this repository release, then retry:

```bash
xattr -dr com.apple.quarantine "/Applications/CLI Commentator.app"
```

### Windows unsigned install

When Windows artifacts are produced:

1. Download the installer/archive from the `Unsigned Smoke` release.
2. If SmartScreen appears, choose `More info`.
3. Confirm the publisher is unknown/unsigned, then choose `Run anyway`.
4. If Microsoft Defender blocks the file, keep the file only when it came from the repository release, then retry after the Defender prompt allows it.

### Linux unsigned install

When Linux artifacts are produced:

1. Download the archive or AppImage from the `Unsigned Smoke` release.
2. For AppImage-style artifacts, add execute permission:

```bash
chmod +x ./CLI-Commentator*.AppImage
```

3. Run it from a terminal first so startup errors stay visible.

```bash
./CLI-Commentator*.AppImage
```

For `.tar.gz` archives, extract the archive and run the included executable from the extracted directory.

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
   - Check `Detect Apple signing/notarization mode`: `enabled=true`
   - Check `Configure macOS keychain for code signing`: certificate import succeeds
   - Check `Detect code signing identity`: a Developer ID identity is detected
   - Check `Log notarization configuration`: expected Apple Team ID/account domain is logged
   - Check `Build and draft release (signed + notarized)`: succeeds for both arm64/x64 jobs
   - Check Draft Release assets include `latest.json`, `.app.tar.gz`, `.sig`, and `.dmg`
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
- `failure_regression` structured log aggregates (`failure-regression-logs/structured-log-summary.json` and `failure-regression-logs/structured-log-captures/*.log`)

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
- In CI, `failure-regression-logs/summary.md` now includes aggregated `startup/failure` and `server/state-event` coverage, while raw details are available in `failure-regression-logs/structured-log-summary.json` and `failure-regression-logs/structured-log-captures/*.log`
- Use `<log-file>` as either an Actions artifact log (for example: `failure-regression-logs/structured-log-captures/startup-and-restart-fallback-activated.log` or `artifacts/failure-regression/console.log`) or local stdout/stderr capture
- For incident triage, start with `startup/failure` and then correlate `server/state-event` and `desktop/server-event` in timeline order

### 6-4. Failure Mapping

`apps/server` `[startup/failure]` and Desktop `status.error` / `[desktop/server-event]` are different layers. The former describes bundled server startup failures, while the latter describes Tauri launcher failures. The Web recovery UI primarily classifies the latter.

| Layer | Primary signal | Representative categories | How to use it |
| --- | --- | --- | --- |
| `apps/server` | `[startup/failure]` `code` | `node_pty_unavailable`, `target_command_not_found`, `target_cwd_not_found`, `target_permission_denied`, `invalid_target_args_json`, `input_file_missing`, `input_file_not_found`, `input_file_permission_denied` | Inspect `target.cmd`, `target.cwd`, `target.inputFile`, `port`, and `fallback.reason` to understand bundled server startup preconditions |
| `apps/desktop` | `status.error` / `[desktop/server-event] detail` | `port_resolve`, `sidecar_manifest_*`, `sidecar_node_missing`, `sidecar_server_entry_missing`, `sidecar_server_root_missing`, `spawn`, `unexpected_exit`, `process_state`, `stop_process`, `wait_shutdown`, `inspect_before_stop` | Separate missing bundle contents from process creation failures and post-launch exits |
| `apps/web` | recovery UI category | `Port resolution error`, `Bundled runtime error`, `Process spawn error`, `Permission error`, `Unexpected server exit`, `Stop flow error`, `Project root error` | Present the first operator action and suggested verification commands |

Operational notes:
- `spawn` with `permission denied` maps to `Permission error`; other `spawn` failures map to `Process spawn error` and should point operators to `node`, `entry`, and `cwd`.
- `desktop_distribution_smoke` keeps `[sidecar_server_entry_missing]` as its negative-path check so smoke coverage stays aligned with the Web-side bundled-runtime guidance.
