<a href="manual-test-checklist.ja.md"><kbd>日本語</kbd></a>
<a href="manual-test-checklist.en.md"><kbd>English</kbd></a>

# Manual Test Checklist (Internal Validation)

This checklist defines a reproducible human test flow while paid Apple certificate setup is deferred.

Assumptions:
- As of 2026-02-20, `APPLE_CERTIFICATE` is not configured, so public signed-release decision stays No-Go
- This checklist targets internal validation with `v0.0.0-smoke.*`

## 1) Precheck (required)

```bash
git switch main
git pull --ff-only
pnpm install
pnpm verify:internal-release
```

Decision:
- [ ] `pnpm verify:internal-release` ends with `ALL CHECKS PASSED`

## 2) Web mode manual test

Terminal A:

```bash
: > /tmp/cc-human.log
INPUT_MODE=file INPUT_FILE=/tmp/cc-human.log LLM_PROVIDER=mock pnpm dev:server
```

Terminal B:

```bash
pnpm dev:web
```

Terminal C:

```bash
echo "gh pr checks --watch" >> /tmp/cc-human.log
echo "error: timeout while calling api" >> /tmp/cc-human.log
```

Decision:
- [ ] Web UI displays both log lines and commentary
- [ ] Server remains alive after error-like log input

## 3) Desktop managed mode manual test

```bash
INPUT_MODE=file INPUT_FILE=/tmp/cc-human.log pnpm dev:desktop:managed
```

Decision:
- [ ] Desktop Server panel `Start` / `Stop` works
- [ ] State transitions to `stopped -> starting -> running`
- [ ] `Check for updates` updates status text in the panel

## 4) Bundled `.app` launch test

```bash
pnpm prepare:desktop-sidecar
pnpm -C apps/desktop tauri:build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
open "apps/desktop/src-tauri/target/release/bundle/macos/CLI Commentator.app"
```

Decision:
- [ ] `.app` launches successfully
- [ ] Desktop panel operations and commentary generation both work

## 5) Recording template

```md
## Manual Test Record: YYYY-MM-DD
- Tester:
- Branch/Commit:
- Environment: macOS <version>

### Result
- Precheck (`pnpm verify:internal-release`): Pass/Fail
- Web mode manual: Pass/Fail
- Desktop managed manual: Pass/Fail
- Bundled .app launch: Pass/Fail

### Notes
- blockers:
- follow-up:
```

## 6) Go/No-Go guideline

- Internal validation:
  - [ ] If sections 1-4 are all Pass, mark Conditional Go
- Public signed distribution:
  - [ ] Keep No-Go until `APPLE_CERTIFICATE` is configured

