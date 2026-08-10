<a href="getting-started.ja.md"><kbd>日本語</kbd></a>
<a href="getting-started.en.md"><kbd>English</kbd></a>

# Getting Started

CLI Commentator captures CLI output (PTY or file tail), extracts events, and streams commentary to the Web UI.

This page is the entry point for **local use and development startup**. Signing, notarization, updater wiring, and draft release validation are not required for normal local use. If you are building or validating distribution artifacts, see `docs/desktop-release.en.md`.

## Prerequisites

- Node.js (recommended: 20+)
- pnpm (enable via `corepack enable` if needed)
- Desktop development only:
  - Rust toolchain (`rustup`)
  - Tauri v2 prerequisites: <https://v2.tauri.app/start/prerequisites/>

Current note: Desktop now ships with sidecar runtime, so released desktop binaries run without local Node/pnpm.  
Development flow (`pnpm dev*` / `tauri:build`) still requires local Node/pnpm.

## Setup

```bash
pnpm install
```

## Local Readiness Check (verify the checkout works)

Run this first after a fresh clone, or when returning to the repository after a break.

```bash
pnpm check:local-readiness
```

It runs sidecar preparation, web lint and build, server tests and typecheck, and the desktop (Rust) tests in order, then prints a PASS / FAIL / SKIP summary.

- Every step runs even if an earlier one fails, so you see the full picture in one pass
- Failed steps print a recovery hint and the command to retry
- Desktop tests report `SKIP` (not a failure) when the Rust toolchain is unavailable
- The exit code is `1` if any step reports `FAIL`

To check only web and server, skip the Tauri/Rust steps:

```bash
pnpm check:local-readiness --skip-desktop
```

Use `--list` to print the commands without running them.

## Run in Desktop Managed Mode (Tauri + web)

This is the primary path for checking the app locally as a desktop app.

```bash
pnpm dev:desktop:managed
```

`dev:desktop:managed` runs `pnpm ensure:desktop-sidecar` before startup. If `src-tauri/binaries`, `resources/server`, or `sidecar-manifest.json` is missing or incomplete, or if the server/shared sources, lockfile, or build configuration changed since the previous preparation, it regenerates the sidecar assets through `prepare:desktop-sidecar`. You can also run the same ensure command directly when you only want to validate the sidecar state.

On macOS, sidecar preparation requires a self-contained Node runtime. If your
Node executable depends on Homebrew libraries such as
`@rpath/libnode.*.dylib` or files under `/opt/homebrew`, preparation stops with
`[sidecar_node_not_portable]` before building. Install Node from nodejs.org (or
use another self-contained distribution) and rerun
`pnpm prepare:desktop-sidecar`.

The Desktop Server panel controls server lifecycle (`Start` / `Stop`) and shows status (`stopped` / `starting` / `running` / `stopping` / `failed`).

If status becomes `failed`, use the guidance shown in the panel and check logs from the same terminal.

When startup fails, the Desktop Server panel shows a recovery card. It includes likely causes, checkpoints, diagnostic details, and copyable `commands to try`, so start with the commands shown there.

Note: In desktop managed mode, if `8787` is occupied, desktop automatically falls back to `8788+` and the UI WebSocket target follows automatically.

In Managed Terminal, `実行を中断（Ctrl+C）` ends only the foreground CLI running inside Managed Terminal. The Desktop Server stays `running`, and you can resume by selecting the same launch settings. standalone server shutdown behavior is unchanged. `CLI_COMMENTATOR_MANAGED_SERVER` is an identifier configured internally by the Tauri sidecar; normal users should not set it manually.

## Run in Web Mode (server + web)

```bash
pnpm dev
```

Expected URLs:

- Server health: `http://localhost:8787/healthz` (`/health` is also supported)
- Web UI: Vite URL (usually `http://localhost:5173`)

## Use Desktop Release Builds

This path is for using already-published `.dmg` builds. It is not the procedure for creating releases, signing artifacts, or validating updater distribution.

- Latest release page: <https://github.com/gatyoukatyou/cli-commentator/releases/latest>
- Distribution operations guide: `docs/desktop-release.en.md`

For normal usage, download `.dmg` (macOS) from Releases and launch it.  
For signing/notarization/updater/release operations, use the distribution operations guide and runbook docs.

## Input Modes

### 1) PTY mode (default)

- Default when `INPUT_MODE` is unset.
- Starts a target shell/command (`TARGET_CMD`, `TARGET_ARGS`, `TARGET_ARGS_JSON`, `TARGET_CWD`).

Examples:

```bash
TARGET_CMD=git TARGET_ARGS="status -sb" pnpm dev:server
```

```bash
TARGET_CMD=node TARGET_ARGS_JSON='["-v"]' pnpm dev:server
```

### 2) File mode (explicit)

Use this when PTY is unavailable or when monitoring external logs.

macOS/Linux:

```bash
INPUT_MODE=file INPUT_FILE=/path/to/app.log pnpm dev:server
pnpm dev:web
```

Windows PowerShell:

```powershell
$env:INPUT_MODE="file"; $env:INPUT_FILE="C:\\logs\\app.log"; pnpm dev:server
pnpm dev:web
```

### 2-b) Commentate Claude Code from another terminal (recommended)

Modern Claude Code uses a fullscreen TUI, so direct `TARGET_CMD=claude` PTY capture is less reliable than
writing canonical lines via hooks and watching them in `file` mode.

1. Install Claude hooks into the target repository.

```bash
pnpm claude:setup-hooks /Users/home/AION_Project/repos/n8n-workflows
```

2. Start `cli-commentator` in Claude-specific file mode.

```bash
pnpm dev:claude:file /Users/home/AION_Project/repos/n8n-workflows
```

3. In another terminal, move to the target repository and start `claude`.

```bash
cd /Users/home/AION_Project/repos/n8n-workflows
claude
```

Notes:

- Hook settings are written to the target repo at `.claude/settings.local.json`.
- The log file is `.claude/cli-commentator.claude.log` under the target repo.
- `pnpm dev:claude:file` clears that log first, then starts with `INPUT_MODE=file` and `LOG_SOURCE=claude`.

### 2-c) Commentate Codex from another terminal (recommended)

Codex can write `codex-tui.log` into a dedicated log directory, so the most stable setup is
to isolate that log per repository and monitor it in `file` mode.

1. Start `cli-commentator` in Codex-specific file mode.

```bash
pnpm dev:codex:file /Users/home/AION_Project/repos/n8n-workflows
```

2. In another terminal, move to the target repository and start `codex` with the same log directory.

```bash
codex --no-alt-screen -C /Users/home/AION_Project/repos/n8n-workflows -c log_dir=/Users/home/AION_Project/repos/n8n-workflows/.codex/cli-commentator-log
```

Notes:

- The log file is `.codex/cli-commentator-log/codex-tui.log` under the target repo.
- `pnpm dev:codex:file` clears that log first, then starts with `INPUT_MODE=file` and `LOG_SOURCE=codex`.
- Saved UI profiles can now store `input mode=file` and `log file=<that log file>` directly.

### 3) Automatic fallback (`pty` -> `file`)

When `INPUT_MODE=pty` and PTY startup fails:

- If `INPUT_FILE` points to an existing file, server automatically switches to file monitoring.
- UI receives a `ptyUnavailable` notice with recovery guidance.
- If `INPUT_FILE` is missing/unreadable, server keeps running without PTY and still shows `ptyUnavailable` guidance.

## Environment Variables (server)

See `apps/server/.env.example`.

Main keys:

- `CLI_COMMENTATOR_PORT` (preferred; default: `8787`)
- `PORT` (legacy fallback)
- `INPUT_MODE` (`pty` or `file`)
- `INPUT_FILE` (required for `INPUT_MODE=file`)
- `TARGET_CMD`, `TARGET_ARGS`, `TARGET_ARGS_JSON`, `TARGET_CWD`
- `LOG_SOURCE` (`auto|claude|codex|generic`)
- `SILENCE_TIMEOUT_MS` (milliseconds without PTY/file output before emitting a silence event; default: `60000`)

Web dev key (must match server port, mainly for web mode):

- `apps/web/.env.development` -> `VITE_WS_PORT`

## Windows Notes

- `node-pty` may require Visual C++ Build Tools.
- If build/load fails, use file mode (`INPUT_MODE=file`).
- For ConPTY-related hangs, try:

PowerShell:

```powershell
$env:PTY_USE_CONPTY='0'; pnpm dev:server
```

cmd.exe:

```cmd
set PTY_USE_CONPTY=0 && pnpm dev:server
```

## Troubleshooting

### Port conflict (`8787` already in use)

Web mode workaround (keep server/web ports aligned):

```bash
CLI_COMMENTATOR_PORT=8788 VITE_WS_PORT=8788 pnpm dev
```

Desktop managed mode:

```bash
CLI_COMMENTATOR_PORT=8788 pnpm dev:desktop:managed
```

Desktop usually auto-falls back to the next available port.  
Only set an explicit start port when repeated conflicts still cause `failed`.

### `Error: posix_spawnp failed`

`node-pty` `spawn-helper` may not be executable.
This is usually auto-fixed by the root `postinstall` during `pnpm install` / `pnpm dev`.
If it still happens, inspect and repair it manually:

```bash
find node_modules/.pnpm -path '*node-pty*' -name spawn-helper -print -exec ls -l {} \;
chmod 755 <path-to-spawn-helper>
```

## Notes

- Commentary is emitted on events, with max rate of once per 2 seconds.
- Raw logs sent to UI are redacted first.
