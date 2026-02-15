<a href="README.ja.md"><kbd>日本語</kbd></a>
<a href="README.en.md"><kbd>English</kbd></a>

# cli-commentator

CLIの出力を別ウィンドウで実況するMVP。

## 概要

本リポジトリは、CLIをPTYで包んで起動し、ログをイベント化して実況テキストを配信するための起点です。MVPはローカルのルールベース実況から始め、後でLLMアダプタを差し替え可能にしていく想定です。

## ドキュメント言語ポリシー

公開ドキュメントは日本語と英語の両方で管理します。

- READMEは `README.ja.md` / `README.en.md` を正とする
- 今後のドキュメントは `docs/<topic>.ja.md` / `docs/<topic>.en.md` のペアで作成する
- 各ドキュメントの先頭に相互リンクの言語切替ボタンを置く

## TARGET_CMD の例

`apps/server/.env` の `TARGET_CMD` に指定します。例: `/bin/bash`, `/bin/zsh`, `powershell`, `claude`, `codex`

## 導入・配布導線

- Getting Started: `docs/getting-started.ja.md`
- Desktop配布ガイド: `docs/desktop-release.ja.md`
- 最新リリース: <https://github.com/gatyoukatyou/cli-commentator/releases/latest>

## トラブルシューティング

- docs/getting-started.ja.md#troubleshooting
