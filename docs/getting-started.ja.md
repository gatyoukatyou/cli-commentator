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

現状メモ: Desktop は sidecar 同梱済みで、配布版の実行に Node/pnpm は不要です。  
ただし開発フロー（`pnpm dev*` / `tauri:build`）にはローカル Node/pnpm が必要です。

## セットアップ

```bash
pnpm install
```

## 配布版（Desktop）を入手して使う

- 最新配布ページ: <https://github.com/gatyoukatyou/cli-commentator/releases/latest>
- 配布ガイド: `docs/desktop-release.ja.md`

通常は Releases から `.dmg`（macOS）を取得して起動します。  
運用や署名/更新まわりの詳細は配布ガイドと runbook を参照してください。

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

`dev:desktop:managed` は起動前に `pnpm ensure:desktop-sidecar` を実行し、`src-tauri/binaries`・`resources/server`・`sidecar-manifest.json` が欠けている場合は `prepare:desktop-sidecar` で再生成します。手動で状態確認だけしたい場合も同じコマンドを直接実行できます。

Desktop Server パネルで server の状態を操作します（`Start` / `Stop`、`stopped` / `starting` / `running` / `stopping` / `failed`）。

`failed` になった場合は、パネルの復旧ガイダンスと同じターミナルのログを確認してください。

起動失敗時は、Desktop Server パネルに復旧カードが表示されます。想定原因、確認ポイント、診断情報に加えて、
その場でコピーできる `試すコマンド` が出るので、まずは表示されたコマンドを順に確認してください。

補足: Desktop managed モードでは、既定ポート `8787` が使用中なら `8788` 以降へ自動退避し、UI の接続先も自動追従します。

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

### 2-b) Claude Code を別ターミナルで実況（推奨）

現行の Claude Code はフルスクリーン TUI なので、`TARGET_CMD=claude` で直接 PTY を読むよりも、
hook でログファイルへ行を書き出し、`file` モードで監視する方が安定します。

1. 対象リポジトリに Claude hook を設定します。

```bash
pnpm claude:setup-hooks /Users/home/AION_Project/repos/n8n-workflows
```

2. `cli-commentator` を Claude 専用 file モードで起動します。

```bash
pnpm dev:claude:file /Users/home/AION_Project/repos/n8n-workflows
```

3. 別ターミナルで対象リポジトリへ移動して `claude` を起動します。

```bash
cd /Users/home/AION_Project/repos/n8n-workflows
claude
```

補足:

- hook 設定は対象リポジトリの `.claude/settings.local.json` に保存されます。
- ログファイルは対象リポジトリの `.claude/cli-commentator.claude.log` です。
- `pnpm dev:claude:file` はこのログを空にしてから `INPUT_MODE=file` / `LOG_SOURCE=claude` で起動します。

### 2-c) Codex を別ターミナルで実況（推奨）

Codex は専用ログディレクトリへ `codex-tui.log` を出せるので、
対象リポジトリごとにログを分離して `file` モードで監視するのが安定します。

1. `cli-commentator` を Codex 専用 file モードで起動します。

```bash
pnpm dev:codex:file /Users/home/AION_Project/repos/n8n-workflows
```

2. 別ターミナルで対象リポジトリへ移動し、同じログディレクトリを指定して `codex` を起動します。

```bash
codex --no-alt-screen -C /Users/home/AION_Project/repos/n8n-workflows -c log_dir=/Users/home/AION_Project/repos/n8n-workflows/.codex/cli-commentator-log
```

補足:

- ログファイルは対象リポジトリの `.codex/cli-commentator-log/codex-tui.log` です。
- `pnpm dev:codex:file` はこのログを空にしてから `INPUT_MODE=file` / `LOG_SOURCE=codex` で起動します。
- UI の保存済みプロファイルでも `入力モード=file` と `ログファイル=<上記ログファイル>` を直接保存できます。

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

Web 側（server port と合わせる、主にWebモードで利用）:

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

Web モードの回避策（server/webを同じポートに合わせる）:

```bash
CLI_COMMENTATOR_PORT=8788 VITE_WS_PORT=8788 pnpm dev
```

Desktop managed モード:

```bash
CLI_COMMENTATOR_PORT=8788 pnpm dev:desktop:managed
```

通常は自動退避で起動できます。  
多数ポート競合などで `failed` になる場合のみ、開始ポートを明示して再試行してください。

### `Error: posix_spawnp failed`

`node-pty` の `spawn-helper` に実行権限が付いていない可能性があります。
通常は `pnpm install` / `pnpm dev` 時の `postinstall` で自動補正されます。
それでも再発する場合は、以下で確認・手動補正してください。

```bash
find node_modules/.pnpm -path '*node-pty*' -name spawn-helper -print -exec ls -l {} \;
chmod 755 <path-to-spawn-helper>
```

## 備考

- 実況はイベント時に生成され、最大 2 秒に 1 回のレート制御があります。
- UI に送る raw ログは先にマスク処理されます。
