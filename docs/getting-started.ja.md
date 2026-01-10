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

## 口調プリセット

Web UIのプルダウンから切り替えできます（標準 / 関西弁 / ずんだもん風）。

## 備考

- 実況テキストは **イベント時 + 最大2秒に1回** で送信されます
- マスク処理は最低限のルールです（強化はShould）
