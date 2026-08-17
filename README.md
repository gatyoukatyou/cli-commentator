<a href="README.ja.md"><kbd>日本語</kbd></a>
<a href="README.en.md"><kbd>English</kbd></a>

# cli-commentator

日本語: CLIの出力を別ウィンドウで実況するMVPのリポジトリです。詳細は `README.ja.md` を参照してください。

English: This repository is an MVP for streaming CLI commentary in a separate window. See `README.en.md` for details.

## Local Use / ローカル利用
- JA docs: `./docs/getting-started.ja.md`
- EN docs: `./docs/getting-started.en.md`
- JA HUMAN user test: `./docs/human-user-test-guide.ja.md`
- EN HUMAN user test: `./docs/human-user-test-guide.en.md`

## Desktop Distribution / Desktop配布
- JA guide: `./docs/desktop-release.ja.md`
- EN guide: `./docs/desktop-release.en.md`
- Latest release: <https://github.com/gatyoukatyou/cli-commentator/releases/latest>

## Target CLI Examples
日本語: `~/.config/cli-commentator/env` の `TARGET_CMD` に指定します。テンプレートは `apps/server/.env.example` です。作業ツリー内に実体の `.env` を作らないでください。例: `/bin/bash`, `/bin/zsh`, `powershell`, `claude`, `codex`

English: Set `TARGET_CMD` in `~/.config/cli-commentator/env`. Use `apps/server/.env.example` as the template and do not create a real `.env` in the worktree. Examples: `/bin/bash`, `/bin/zsh`, `powershell`, `claude`, `codex`

## Troubleshooting
- JA: docs/getting-started.ja.md#troubleshooting
- EN: docs/getting-started.en.md#troubleshooting
