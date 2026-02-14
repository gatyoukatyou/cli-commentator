# Sidecar Layout (Sprint 28)

This project packages a Node sidecar for desktop distribution with this layout:

- `src-tauri/bin/<platform-arch>/node(.exe)`
- `src-tauri/resources/server/**`
- `src-tauri/resources/sidecar-manifest.json`

`<platform-arch>` is generated from Node runtime values, for example:

- `darwin-arm64`
- `darwin-x64`
- `linux-x64`
- `win32-x64`

## Build command

From repository root:

```bash
pnpm build:sidecar
```

This command:

1. Builds `apps/server` into `dist/`
2. Deploys production server dependencies
3. Copies server runtime artifacts into `src-tauri/resources/server`
4. Copies current Node runtime into `src-tauri/bin/<platform-arch>`
5. Writes `src-tauri/resources/sidecar-manifest.json`
