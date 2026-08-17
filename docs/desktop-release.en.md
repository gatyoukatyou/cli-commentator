<a href="desktop-release.ja.md"><kbd>日本語</kbd></a>
<a href="desktop-release.en.md"><kbd>English</kbd></a>

# Desktop Release Guide (Tauri)

This page is the practical checklist for **desktop distribution operators**. If you only want to run and use the app locally, start with `docs/getting-started.en.md`.  
Current status: **Auto-start and in-app update checks are implemented**, and this repo now includes updater/release automation foundations.

## Current baseline

- Auto-start can be enabled/disabled from the Desktop Server panel
- Updater check can be triggered from the Desktop Server panel (`Check updates`)
- `apps/desktop/src-tauri/tauri.conf.json` includes updater endpoint + artifact generation settings
- `.github/workflows/release-desktop.yml` provides tag-triggered draft release automation
- `desktop_check` CI runs on every PR (`cargo check` + `cargo test`)
- `scripts/verify-updater-config.mjs` validates updater pubkey format and signing-key pairing

## Desktop runtime maintenance

Tauri runtime stack has been refreshed to the 2.11 series, including `tauri`,
`tauri-runtime`, `tauri-runtime-wry`, and related window/tray dependencies such
as `wry`, `tao`, `tray-icon`, and `muda`.

This is a runtime maintenance update only. It does not change the desktop
distribution procedure, signing/notarization flow, updater configuration, or
operator-facing release steps. Existing `desktop_check` and
`desktop_distribution_smoke` CI jobs remain the validation path for this change.

## Sidecar native helper permissions

The sidecar bundles node-pty, which opens a PTY on macOS and Linux by spawning
its `spawn-helper` binary. `pnpm deploy --prod`, which stages the sidecar's
production dependencies, writes that file **without the executable bit**, so
`prepare-desktop-sidecar.mjs` restores it after bundling and asserts that the
host platform's helper is executable.

Do not proceed with a build when that assertion fails. Without the bit the app
breaks in a way that is easy to misread: **the server reports `running` while
every CLI launch fails**, including plain `bash`.

```
startup_failed  kind=ptyError; error=posix_spawnp failed.  cmd=bash
```

When you see `posix_spawnp failed.`, check this first:

```bash
ls -l apps/desktop/src-tauri/resources/server/node_modules/node-pty/prebuilds/*/spawn-helper
```

Re-run `pnpm prepare:desktop-sidecar` if the bit is missing. The repository's
own `node_modules` is handled separately by the
`scripts/fix-node-pty-permissions.mjs` postinstall hook.

## Release action maintenance

`tauri-apps/tauri-action@v1.0.0` is maintained as the tag-release workflow
action. The update does not change the signed/unsigned release branches,
signing or notarization inputs, or updater configuration, but it changes the
release artifacts and the checks required before merging a workflow update:

- `.app.tar.gz` and matching `.app.tar.gz.sig` assets include the app version in
  their filenames. Do not assume the previous unversioned basename.
- With the current `tagName` input, each `latest.json` platform URL points to
  the versioned asset in the tagged release (`releases/download/<tag>/<asset>`).
  The updater endpoint that downloads `latest.json` remains
  `releases/latest/download/latest.json`; validate the URLs inside the file
  against the actual assets.
- When `tagName` refers to an existing release, `releaseDraft` must match that
  release's state. Using `releaseDraft: true` against an existing non-Draft
  release fails; do not reuse such a tag for a Draft update.

The current workflow change is limited to the action version. The Unsigned
Smoke gate below is still required before merging it.

## Updater plugin maintenance

`tauri-plugin-updater` has been refreshed to 2.10.1. This maintenance update
preserves updater package file extensions when presenting installation prompts;
it does not change updater endpoint configuration, signing inputs, release
artifact layout, or operator-facing release steps.

Related docs:
- Local use and development startup: `docs/getting-started.en.md`
- Detailed operations (including recovery/rollback): `docs/release-runbook.en.md`
- Certificate/secrets operations: `docs/certificate-secrets.en.md`

## 1) Generate signing keys (for updater)

Tauri updater requires signed artifacts. Generate a key pair first.

```bash
pnpm -C apps/desktop tauri signer generate -w ~/.tauri/cli-commentator-updater.key
```

Generated files:

- `~/.tauri/cli-commentator-updater.key` (private key)
- `~/.tauri/cli-commentator-updater.key.pub` (public key)

> Never commit private keys to the repository.

## 2) Signing environment variables for builds

For local/CI builds that produce signed updater artifacts, set:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Example:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/cli-commentator-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="***"
```

For GitHub Actions, store the same values as repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## 2.5) Required secrets for macOS signing/notarization

The `release-desktop` workflow requires these repository secrets:

- `APPLE_CERTIFICATE` (base64 of `.p12`)
- `APPLE_CERTIFICATE_PASSWORD`
- `KEYCHAIN_PASSWORD`
- `APPLE_ID`
- `APPLE_PASSWORD` (app-specific password)
- `APPLE_TEAM_ID`

After registration, run `pnpm verify:apple-signing` to validate format (export values in the same shell first).

## 3) Updater settings in `tauri.conf.json` (when enabling)

Set `apps/desktop/src-tauri/tauri.conf.json` like this:

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "public key contents (.pub file)",
      "endpoints": [
        "https://github.com/gatyoukatyou/cli-commentator/releases/latest/download/latest.json"
      ]
    }
  }
}
```

`pubkey` must be the actual public-key text (base64 string generated by `tauri signer generate`).
If you rotate signing keys, update `pubkey` and re-run release validation.

## 3.5) Updater distribution contract

The desktop updater contract is intentionally narrow:

- Check trigger: the user clicks `Check updates` in the Desktop Server panel.
- Endpoint: `https://github.com/gatyoukatyou/cli-commentator/releases/latest/download/latest.json`.
- Release source: GitHub Release assets from the latest published release.
- Supported updater platforms: `darwin-aarch64`, `darwin-aarch64-app`, `darwin-x86_64`, and `darwin-x86_64-app`.
- Asset resolution: each `latest.json` platform entry must point to the
  matching versioned `.app.tar.gz` asset for that architecture in the tagged
  release.
- Signature: each platform entry must include a non-empty updater signature,
  and the matching versioned `.app.tar.gz.sig` asset must be present in the
  release.
- Installers: `.dmg` assets are the human install path; `.app.tar.gz` and `.sig` assets are the updater path.
- Failure UX: updater failures are surfaced in the Desktop Server panel. Use `Copy Debug bundle` to capture version, platform, server state, updater result, paths, and timestamp for triage.

The current app does not run a silent update check on startup. Startup should remain focused on launching the bundled server; updater checks are an explicit support/action path until an automatic policy is added.

## 4) Tag-based release workflow

This repository includes `.github/workflows/release-desktop.yml`.

Trigger:

- manual: `workflow_dispatch`
- tag push: `v*` (for example `v0.1.0`)

The workflow:

1. Runs lint/build/tests
2. Builds Tauri bundles for both macOS architectures
3. Creates a draft GitHub Release with updater artifacts

## 4.5) Pre-merge Unsigned Smoke gate for release workflow changes

Run an actual `v0.0.0-smoke.*` Unsigned Smoke before merging a change to
`tauri-apps/tauri-action` or this release workflow. Until that run is
complete, the items below are pre-merge checks, not confirmed results:

- [ ] Confirm arm64 and x64 each produce `.app.tar.gz` and matching
      `.app.tar.gz.sig` filenames that include the app version.
- [ ] Inspect `latest.json` and confirm both architecture entries point to the
      matching versioned assets and contain non-empty signatures.
- [ ] Confirm the resulting release is Draft and prerelease, and keep it
      unpublished while the smoke evidence is reviewed.

Record the run URL and the exact asset filenames in the release evidence. Do
not describe any item as confirmed when the Unsigned Smoke has not actually
run.

## 5) Verify updater wiring from Desktop panel

After setting `plugins.updater`, start desktop managed mode and verify:

1. `pnpm dev:desktop:managed`
2. Open Desktop Server panel and click `Check updates`
3. Confirm one of:
   - `Updater: up to date`
   - `Updater: update available (vX.Y.Z)`
4. If you still see `Updater: not configured`, re-check `pubkey` and `endpoints` in `tauri.conf.json`
5. Click `Copy Debug bundle` and confirm the copied text includes the updater result and paths.

## 6) Minimal release flow

1. Bump `apps/desktop/package.json`, `Cargo.toml`, `cli-commentator-desktop` in `Cargo.lock`, and `tauri.conf.json` to the same version (and update release notes if needed)
2. `pnpm -C apps/web build`
3. `pnpm -C apps/desktop tauri:build`
4. Create and push tag:
   - `git tag -a vX.Y.Z -m "vX.Y.Z"`
   - `git push origin vX.Y.Z`
5. Validate draft release assets, including `latest.json`, versioned `.app.tar.gz`, matching versioned `.app.tar.gz.sig`, and `.dmg`
6. Publish the draft only after the updater contract is satisfied
7. Verify update checks from an installed app

## 6.5) Recommended preflight command

```bash
pnpm verify:updater
```

When `TAURI_SIGNING_PRIVATE_KEY` is set, this command runs a signing smoke test and validates key-id consistency against `plugins.updater.pubkey` in `tauri.conf.json`.

## 7) Remaining tasks (next sprint)

- Harden notarization operations (especially during secret rotation)
- Add Windows code signing in CI
- Expand release matrix beyond macOS when distribution targets are finalized
