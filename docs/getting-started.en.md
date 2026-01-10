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

## Tone presets

Use the web UI dropdown to switch between Standard / Kansai / Zundamon (text).

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

## Notes

- Commentary is emitted **on events + at most once per 2 seconds**
- Redaction is minimal in the MVP (hardening is a Should)
