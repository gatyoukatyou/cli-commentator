<a href="release-runbook.ja.md"><kbd>日本語</kbd></a>
<a href="release-runbook.en.md"><kbd>English</kbd></a>

# Desktop Release Runbook v1

This runbook defines the operational steps for safe tag-triggered desktop releases.  
Target workflow: `.github/workflows/release-desktop.yml`.

## 0) Prerequisites

- Repository: `gatyoukatyou/cli-commentator`
- Intended branch changes are already pushed
- Required repository secrets:
  - `TAURI_SIGNING_PRIVATE_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  - `APPLE_CERTIFICATE`
  - `APPLE_CERTIFICATE_PASSWORD`
  - `KEYCHAIN_PASSWORD`
  - `APPLE_ID`
  - `APPLE_PASSWORD`
  - `APPLE_TEAM_ID`

## 1) Pre-release checks (required)

### 1-1. Local verification

```bash
pnpm install
pnpm verify:updater
pnpm -C apps/web lint
pnpm -C apps/web build
CLI_COMMENTATOR_FORCE_NO_PTY=1 pnpm -C apps/server test
```

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
5. Validate Draft Release assets (signed updater artifacts)
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

### Case B: `tauri-action` build/signing fails

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

### Case C: Draft Release missing artifacts

Symptoms:
- Missing `latest.json` or expected platform artifacts

Actions:
1. Check workflow matrix and `bundle.targets`
2. Fix and re-run from corrected tag
3. Delete incomplete draft and regenerate

### Case D: notarization failure

Symptoms:
- Build finishes but notarization step fails

Actions:
1. Re-check `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`
2. Verify Apple account state (for example expired app-specific password)
3. Update secrets if needed and rerun with corrected tag

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

Keeping these four points makes later incidents much easier to reproduce and fix.

## 6) Reference: state-transition log format

Desktop server lifecycle transitions are emitted to stderr in this format:

```text
[desktop/server-event] {"ts":1739394000123,"trigger":"begin_start_transition","from":"stopped","to":"starting","operation_id":12,"pid":null,"port":8787,"detail":null}
```

Key fields:
- `trigger`: transition source handler
- `from` / `to`: lifecycle state transition
- `operation_id`: start/stop operation identifier
- `detail`: optional context (`exit_code`, failure detail, etc.)
