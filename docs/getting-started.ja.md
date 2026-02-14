<a href="getting-started.ja.md"><kbd>日本語</kbd></a>
<a href="getting-started.en.md"><kbd>English</kbd></a>

# Getting Started

CLI Commentator は CLI 出力（PTY またはログファイル tail）を取り込み、イベント化して Web UI に実況を流します。

## 前提

- Node.js（推奨: 20+）
- pnpm（必要なら `corepack enable`）
- Desktop 開発時のみ:
  - Rust ツールチェーン（`rustup`）
  - Tauri v2 前提: <https://v2.tauri.app/start/prerequisites/>

現状メモ: Node/pnpm なしで動く Desktop sidecar 同梱は Sprint 28 で対応中です。現時点の開発フローはローカル Node/pnpm が必要です。

## セットアップ

```bash
pnpm install
```

## Web モードで起動（server + web）

```bash
pnpm dev
```

起動URLの目安:

- Server health: `http://localhost:8787/healthz`（`/health` も互換で利用可能）
- Web UI: Vite が表示する URL（通常 `http://localhost:5173`）

## Desktop managed モードで起動（Tauri + web）

```bash
pnpm dev:desktop:managed
```

Desktop Server パネルで server の状態を操作します（`Start` / `Stop`、`stopped` / `starting` / `running` / `stopping` / `failed`）。

`failed` になった場合は、パネルの復旧ガイダンスと同じターミナルのログを確認してください。

## 入力モード

### 1) PTY モード（デフォルト）

- `INPUT_MODE` 未設定時の既定値です。
- `TARGET_CMD`, `TARGET_ARGS`, `TARGET_ARGS_JSON`, `TARGET_CWD` で対象 CLI を切り替えます。

例:

```bash
TARGET_CMD=git TARGET_ARGS="status -sb" pnpm dev:server
```

```bash
TARGET_CMD=node TARGET_ARGS_JSON='["-v"]' pnpm dev:server
```

### 2) file モード（明示指定）

PTY が使えない環境や、外部ログ監視で使います。

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

### 3) 自動フォールバック（`pty` -> `file`）

`INPUT_MODE=pty` で PTY 初期化に失敗した場合:

- `INPUT_FILE` が既存ファイルなら file 監視へ自動切替します。
- UI には `ptyUnavailable` 通知と復旧ヒントが表示されます。
- `INPUT_FILE` が未設定/不正でも server は継続し、`ptyUnavailable` のガイダンスを表示します。

## 環境変数（server）

`apps/server/.env.example` を参照してください。

主要キー:

- `CLI_COMMENTATOR_PORT`（推奨、既定: `8787`）
- `PORT`（後方互換のフォールバック）
- `INPUT_MODE`（`pty` or `file`）
- `INPUT_FILE`（`INPUT_MODE=file` で必須）
- `TARGET_CMD`, `TARGET_ARGS`, `TARGET_ARGS_JSON`, `TARGET_CWD`
- `LOG_SOURCE`（`auto|claude|codex|generic`）

Web 側（server port と合わせる）:

- `apps/web/.env.development` -> `VITE_WS_PORT`

## Windows 注意点

- `node-pty` は Visual C++ Build Tools が必要な場合があります。
- ビルド/読み込みに失敗する場合は `INPUT_MODE=file` を利用してください。
- ConPTY 起因のハングがある場合は以下で無効化を試してください。

PowerShell:

```powershell
$env:PTY_USE_CONPTY='0'; pnpm dev:server
```

cmd.exe:

```cmd
set PTY_USE_CONPTY=0 && pnpm dev:server
```

## トラブルシューティング

### ポート競合（`8787` が使用中）

現状挙動:

- server が起動失敗する場合があります。
- Desktop パネルは `failed` に遷移することがあります。

回避策:

```bash
CLI_COMMENTATOR_PORT=8788 VITE_WS_PORT=8788 pnpm dev
```

Desktop managed の回避策:

```bash
CLI_COMMENTATOR_PORT=8788 VITE_WS_PORT=8788 pnpm dev:desktop:managed
```

### `Error: posix_spawnp failed`

`node-pty` の `spawn-helper` に実行権限が付いていない可能性があります。

```bash
find node_modules/.pnpm -path '*node-pty*' -name spawn-helper -print -exec ls -l {} \;
chmod 755 <path-to-spawn-helper>
```

## 備考

- 実況はイベント時に生成され、最大 2 秒に 1 回のレート制御があります。
- UI に送る raw ログは先にマスク処理されます。
