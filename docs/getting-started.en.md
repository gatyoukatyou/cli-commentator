<a href="getting-started.ja.md"><kbd>日本語</kbd></a>
<a href="getting-started.en.md"><kbd>English</kbd></a>

# Getting Started

CLI Commentator captures CLI output (PTY or file tail), extracts events, and streams commentary to the Web UI.

## Prerequisites

- Node.js (recommended: 20+)
- pnpm (enable via `corepack enable` if needed)
- Desktop development only:
  - Rust toolchain (`rustup`)
  - Tauri v2 prerequisites: <https://v2.tauri.app/start/prerequisites/>

Current note: Desktop sidecar packaging (Node/pnpm-free runtime) is in progress in Sprint 28. For now, development flow still uses local Node/pnpm.

## Setup

```bash
pnpm install
```

## Run in Web Mode (server + web)

```bash
pnpm dev
```

Expected URLs:

- Server health: `http://localhost:8787/healthz` (`/health` is also supported)
- Web UI: Vite URL (usually `http://localhost:5173`)

## Run in Desktop Managed Mode (Tauri + web)

```bash
pnpm dev:desktop:managed
```

The Desktop Server panel controls server lifecycle (`Start` / `Stop`) and shows status (`stopped` / `starting` / `running` / `stopping` / `failed`).

If status becomes `failed`, use the guidance shown in the panel and check logs from the same terminal.

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

Web dev key (must match server port):

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

Current behavior:

- Server may fail to start.
- Desktop panel can move to `failed`.

Workaround:

```bash
CLI_COMMENTATOR_PORT=8788 VITE_WS_PORT=8788 pnpm dev
```

Desktop managed workaround:

```bash
CLI_COMMENTATOR_PORT=8788 VITE_WS_PORT=8788 pnpm dev:desktop:managed
```

### `Error: posix_spawnp failed`

`node-pty` `spawn-helper` may not be executable.

```bash
find node_modules/.pnpm -path '*node-pty*' -name spawn-helper -print -exec ls -l {} \;
chmod 755 <path-to-spawn-helper>
```

## Notes

- Commentary is emitted on events, with max rate of once per 2 seconds.
- Raw logs sent to UI are redacted first.
