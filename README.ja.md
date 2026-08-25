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

`~/.config/cli-commentator/env` の `TARGET_CMD` に指定します。テンプレートは `apps/server/.env.example` です。作業ツリー内に実体の `.env` を作らないでください。例: `/bin/bash`, `/bin/zsh`, `powershell`, `claude`, `codex`, `hermes`

## ローカルで使う・開発する

まずはこちらを読んでください。ローカル起動や日常利用の確認では、署名・Notarization・Updater配布の手順は不要です。

- Getting Started: `docs/getting-started.ja.md`
- HUMANユーザーテストガイド: `docs/human-user-test-guide.ja.md`

## 配布・リリースを運用する

配布版の作成、署名、Notarization、Updater、Draft Release確認はこちらです。

- Desktop配布ガイド: `docs/desktop-release.ja.md`
- 最新リリース: <https://github.com/gatyoukatyou/cli-commentator/releases/latest>

## トラブルシューティング

- docs/getting-started.ja.md#troubleshooting
