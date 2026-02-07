<a href="getting-started.ja.md"><kbd>日本語</kbd></a>
<a href="getting-started.en.md"><kbd>English</kbd></a>

# Getting Started（MVP）

このMVPは「PTYでCLIを起動 → イベント化 → 実況をWeb UIで表示」の最小構成です。

## 前提

- Node.js がインストール済み
- pnpm が使える（`corepack enable` で有効化できます）

## セットアップ

```bash
pnpm install
```

## 開発起動

```bash
pnpm dev
```

起動後の目安：

- Server: `http://localhost:8787/health`
- Web UI: Vite が表示するURL（通常 `http://localhost:5173`）

## デスクトップ開発（managed）

`pnpm dev:desktop:managed` で Web と Tauri を同時に起動できます。

```bash
pnpm dev:desktop:managed
```

### 前提

- Rust ツールチェーン（`rustup`）が導入済み
- Tauri v2 のビルド前提を満たしていること（OS別の詳細は [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)）

### 状態遷移（Tauri Debug パネル）

起動/停止は `state` を単一ソースとして表示します。

- 起動: `stopped -> starting -> running`
- 停止: `running -> stopping -> stopped`
- 失敗: `failed`（理由は `error` に表示）
- 復旧: `failed` から `Start` で再試行

### 連打ガード

- `starting` / `running` の間は Start が無効（多重起動防止）
- `stopping` / `stopped` の間は Stop が無効（多重停止防止）

### 失敗の再現と復旧

例: `8787` ポートを先に他プロセスで占有すると `failed` に遷移します。

1. 競合プロセスを停止
2. Tauri Debug パネルで `Start` を押して再試行
3. `running` に戻ることを確認

### ログの確認場所

- `pnpm dev:desktop:managed` を実行しているターミナル
- ここに Tauri 側と `apps/server` 側のログが出力されます

## 対象CLIの差し替え

デフォルトは `bash` をPTYで起動します。別のCLIに変える場合は `TARGET_CMD` を指定します。

macOS/Linux:

```bash
TARGET_CMD=your-cli pnpm -C apps/server dev
```

Windows（PowerShell）:

```powershell
$env:TARGET_CMD="your-cli"; pnpm -C apps/server dev
```

Windows（cmd.exe）:

```cmd
set TARGET_CMD=your-cli && pnpm -C apps/server dev
```

引数を渡す場合は `TARGET_ARGS` を空白区切りで指定します。

```bash
TARGET_CMD=git TARGET_ARGS="status -sb" pnpm -C apps/server dev
```

## ログソースの指定（LOG_SOURCE）

`apps/server/.env` に `LOG_SOURCE` を指定すると、ログ解析ルールセットを選択できます。

- `auto`（デフォルト）: 行の特徴から自動判定し、該当がなければ `generic` を使う
- `claude` / `codex` / `generic`: 明示指定

## 口調プリセット

Web UIのプルダウンから切り替えできます（標準 / 関西弁 / ずんだもん風）。

## UI同期の確認（2タブ）

1. ブラウザで2タブ開く（A/B）。
2. タブAで `standard → kansai → zundamon` と切り替える。
3. タブBの口調表示が即時に追随する。
4. 直後の実況（commentary）が新しい口調で表示される。

<a name="troubleshooting"></a>
## トラブルシューティング

### Error: posix_spawnp failed

`node-pty` の `spawn-helper` に実行権限が付いていない場合があります（pnpm 配下で起きやすい報告あり）。

```bash
find node_modules/.pnpm -path '*node-pty*' -name spawn-helper -print -exec ls -l {} \;
```

実行権限が付いていない場合は付与してください。

```bash
chmod 755 <path-to-spawn-helper>
```

`node_modules` は再インストールで戻る可能性があるため、再発時は同じ手順で対応してください。

## Windows 向け注意事項

### 必要条件

- Windows 10 1809+ (ConPTY対応)
- Node.js 20+
- Visual C++ Build Tools (node-pty ビルド用)

### デフォルトシェル

プロファイル無しで起動した場合、Windowsでは `powershell.exe` がデフォルトになります（Unix系は `bash`）。

### 引数にスペースを含む場合

`TARGET_ARGS_JSON` を使用（JSON配列形式）:

**PowerShell:**

```powershell
$env:TARGET_ARGS_JSON='["-NoProfile","-Command","echo hello world"]'; pnpm dev:server
```

**cmd.exe:**

```cmd
set TARGET_ARGS_JSON=["-NoProfile","-Command","echo hello world"] && pnpm dev:server
```

### ConPTY ハング対策

デバッガ使用時などでハングする場合:

**PowerShell:**

```powershell
$env:PTY_USE_CONPTY='0'; pnpm dev:server
```

**cmd.exe:**

```cmd
set PTY_USE_CONPTY=0 && pnpm dev:server
```

### Windows トラブルシューティング

#### node-pty がビルドに失敗する

node-pty のビルドには Visual C++ Build Tools が必要ですが、
ビルドできない環境でも **file モード** で cli-commentator を使用できます。

`INPUT_MODE=pty` のままでも `INPUT_FILE` が設定されていれば、
node-pty 初期化失敗時に file 監視モードへ自動フォールバックします。

**file モードで起動する例:**

```bash
# 監視したいログファイルを指定
INPUT_MODE=file INPUT_FILE=/path/to/your-app.log pnpm dev:server

# 別ターミナルで Web UI を起動
pnpm dev:web
```

**根本解決したい場合:**

Visual C++ Build Tools をインストールしてください。

**推奨:** Visual Studio Installer で「C++ によるデスクトップ開発」ワークロードをインストール

```
1. Visual Studio Installer を起動
2. 「変更」→「ワークロード」タブ
3. 「C++ によるデスクトップ開発」にチェック → インストール
```

または [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) を直接インストール:

1. 「C++ によるデスクトップ開発」ワークロードを選択
2. Node.js を再インストール（または `npm config set msvs_version 2022`）
3. `pnpm install` を再実行

> **注:** `npm install --global windows-build-tools` は環境によっては途中で止まる報告があるため非推奨。

#### デバッガ使用時にハングする

`PTY_USE_CONPTY=0` を設定するか、`--inspect` フラグを外してください。
自動検知により、`--inspect` / `--inspect-brk` が検出された場合は ConPTY が自動で無効化されます。

## 備考

- 実況テキストは **イベント時 + 最大2秒に1回** で送信されます
- マスク処理は最低限のルールです（強化はShould）
- 手動停止時に `exit code 143` が出ることがあります（SIGTERMのため正常な挙動）
