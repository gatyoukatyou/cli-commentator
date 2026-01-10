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

## 備考

- 実況テキストは **イベント時 + 最大2秒に1回** で送信されます
- マスク処理は最低限のルールです（強化はShould）
- 手動停止時に `exit code 143` が出ることがあります（SIGTERMのため正常な挙動）
