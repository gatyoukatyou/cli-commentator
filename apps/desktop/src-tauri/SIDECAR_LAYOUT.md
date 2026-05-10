# Sidecar Layout (Sprint 28)

This project packages a Node sidecar for desktop distribution with this layout:

- `src-tauri/binaries/node-$TARGET_TRIPLE/node(.exe)`
- `src-tauri/resources/server/**`
- `src-tauri/resources/sidecar-manifest.json`

`$TARGET_TRIPLE` comes from `rustc --print host-tuple` (or `rustc -Vv` fallback), for example:

- `aarch64-apple-darwin`
- `x86_64-apple-darwin`
- `x86_64-unknown-linux-gnu`
- `x86_64-pc-windows-msvc`

## Build command

From repository root:

```bash
pnpm prepare:desktop-sidecar
```

This command:

1. Builds `apps/server` into `dist/`
2. Deploys production server dependencies
3. Copies server runtime artifacts into `src-tauri/resources/server`
4. Copies current Node runtime into `src-tauri/binaries/node-$TARGET_TRIPLE/node(.exe)`
5. Writes `src-tauri/resources/sidecar-manifest.json`
