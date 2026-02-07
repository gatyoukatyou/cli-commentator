<a href="getting-started.ja.md"><kbd>日本語</kbd></a>
<a href="getting-started.en.md"><kbd>English</kbd></a>

# Getting Started (MVP)

This MVP runs a target CLI under a PTY, turns logs into events, and streams commentary to a web UI.

## Prerequisites

- Node.js installed
- pnpm available (enable with `corepack enable` if needed)

## Setup

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

Expected URLs:

- Server: `http://localhost:8787/health`
- Web UI: the URL printed by Vite (typically `http://localhost:5173`)

## Desktop Development (managed)

Use `pnpm dev:desktop:managed` to run Web + Tauri together.

```bash
pnpm dev:desktop:managed
```

### Prerequisites

- Rust toolchain installed (`rustup`)
- Tauri v2 build prerequisites satisfied for your OS ([Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/))

### State transitions (Tauri Debug panel)

Start/stop status is exposed as a single `state` source.

- Start: `stopped -> starting -> running`
- Stop: `running -> stopping -> stopped`
- Failure: `failed` (reason is shown in `error`)
- Recovery: retry from `failed` by pressing `Start`

### Double-click / spam guards

- Start is disabled while `starting` or `running` (prevents duplicate start)
- Stop is disabled while `stopping` or `stopped` (prevents duplicate stop)

### Reproducing and recovering from failure

Example: if another process already uses port `8787`, the state should move to `failed`.

1. Stop the conflicting process
2. Press `Start` in the Tauri Debug panel
3. Confirm state returns to `running`

### Where to read logs

- The terminal running `pnpm dev:desktop:managed`
- Both Tauri-side and `apps/server` logs are printed there

## Switch the target CLI

The default target is `bash`. To run another CLI, set `TARGET_CMD`.

macOS/Linux:

```bash
TARGET_CMD=your-cli pnpm -C apps/server dev
```

Windows (PowerShell):

```powershell
$env:TARGET_CMD="your-cli"; pnpm -C apps/server dev
```

Windows (cmd.exe):

```cmd
set TARGET_CMD=your-cli && pnpm -C apps/server dev
```

To pass arguments, set `TARGET_ARGS` with space-separated values.

```bash
TARGET_CMD=git TARGET_ARGS="status -sb" pnpm -C apps/server dev
```

## Log source selection (LOG_SOURCE)

Set `LOG_SOURCE` in `apps/server/.env` to choose a ruleset.

- `auto` (default): detect from line patterns, fallback to `generic`
- `claude` / `codex` / `generic`: explicit selection

## Tone presets

Use the web UI dropdown to switch between Standard / Kansai / Zundamon (text).

## UI sync check (two tabs)

1. Open two browser tabs (A/B).
2. In tab A, switch `standard → kansai → zundamon`.
3. Tab B should update its displayed style immediately.
4. Subsequent commentary should follow the new style.

<a name="troubleshooting"></a>
## Troubleshooting

### Error: posix_spawnp failed

The `node-pty` `spawn-helper` binary may lack execute permissions (commonly reported under pnpm layouts).

```bash
find node_modules/.pnpm -path '*node-pty*' -name spawn-helper -print -exec ls -l {} \;
```

If it is not executable, add permissions:

```bash
chmod 755 <path-to-spawn-helper>
```

`node_modules` can be regenerated on reinstall, so repeat this if the issue returns.

### node-pty build failure on Windows

`node-pty` requires Visual C++ Build Tools. If build fails, you can still run in file monitoring mode.

If `INPUT_MODE=pty` and `INPUT_FILE` is already set, the server automatically falls back to file monitoring when PTY initialization fails.

```bash
# Explicit file mode
INPUT_MODE=file INPUT_FILE=/path/to/your-app.log pnpm dev:server
```

## Notes

- Commentary is emitted **on events + at most once per 2 seconds**
- Redaction is minimal in the MVP (hardening is a Should)
- You may see `exit code 143` when you stop the process manually (SIGTERM)
