<a href="desktop-release.ja.md"><kbd>日本語</kbd></a>
<a href="desktop-release.en.md"><kbd>English</kbd></a>

# Desktop Release Guide (Tauri)

This page is the practical checklist for desktop distribution.  
Current status: **Auto-start is implemented**, while **updater/signing is in setup phase**.

## Current baseline

- Auto-start can be enabled/disabled from the Desktop Server panel
- `desktop_check` CI runs on every PR (`cargo check` + `cargo test`)

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

## 3) Updater settings in `tauri.conf.json` (when enabling)

When you turn updater on, set `apps/desktop/src-tauri/tauri.conf.json` like this:

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "public key contents (.pub file)",
      "endpoints": [
        "https://example.com/cli-commentator/{{target}}/{{arch}}/{{current_version}}",
        "https://github.com/<owner>/<repo>/releases/latest/download/latest.json"
      ]
    }
  }
}
```

## 4) Minimal release flow

1. Bump version (`tauri.conf.json` and release notes if needed)
2. `pnpm -C apps/web build`
3. `pnpm -C apps/desktop tauri:build`
4. Publish bundle artifacts and update metadata to distribution host
5. Verify update checks from an installed app

## 5) Remaining tasks (next sprint)

- Enable updater in production (endpoint operation + key management policy)
- Add macOS signing/notarization and Windows code signing in CI
- Create tag-driven GitHub Actions release workflow

