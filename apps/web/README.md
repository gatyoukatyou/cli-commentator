# @cli-commentator/web

Web UI for CLI Commentator.

## Development

From repository root:

```bash
pnpm dev:web
```

Or directly in this package:

```bash
pnpm -C apps/web dev
```

## Build

```bash
pnpm -C apps/web build
```

## Test / Lint

```bash
pnpm -C apps/web test
pnpm -C apps/web lint
```

## Environment

- `VITE_WS_PORT` must match server port (`CLI_COMMENTATOR_PORT`, or legacy `PORT`).
- See `apps/web/.env.example` and `apps/web/.env.development`.

Example:

```bash
CLI_COMMENTATOR_PORT=8788 VITE_WS_PORT=8788 pnpm dev
```
