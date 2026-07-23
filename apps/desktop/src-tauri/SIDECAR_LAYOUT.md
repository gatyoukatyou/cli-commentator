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
4. On macOS, rejects a Node runtime that depends on non-system libraries outside the bundle
5. Copies the current Node runtime into `src-tauri/binaries/node-$TARGET_TRIPLE/node(.exe)`
6. Runs the copied Node with `--version` as a startup smoke test
7. Writes `src-tauri/resources/sidecar-manifest.json`

Homebrew Node builds can depend on `@rpath/libnode.*.dylib` and libraries under
`/opt/homebrew`. Those builds cannot be packaged by copying only the executable,
so preparation stops with `[sidecar_node_not_portable]`. Use a self-contained
Node distribution, such as the installer from nodejs.org, and rerun the command.
