# cli-commentator

CLIの出力を別ウィンドウで実況するMVP

## Quick Start

```bash
pnpm install
pnpm dev          # サーバー + Web UI 同時起動
```

- Server: http://localhost:8787
- Web UI: http://localhost:5173

## Project Structure

```
cli-commentator/
├── apps/
│   ├── server/           # バックエンド (TypeScript)
│   │   ├── src/
│   │   │   ├── index.ts      # エントリポイント (PTY + WebSocket)
│   │   │   ├── extract.ts    # イベント抽出
│   │   │   ├── redact.ts     # マスキング処理
│   │   │   ├── types.ts      # 型定義
│   │   │   ├── styles/       # 実況スタイル
│   │   │   │   ├── standard.ts   # 標準
│   │   │   │   ├── kansai.ts     # 関西弁
│   │   │   │   └── zundamon.ts   # ずんだもん風
│   │   │   ├── rulesets/     # CLI検出ルール
│   │   │   │   ├── detect.ts     # 自動検出
│   │   │   │   ├── claude.ts     # Claude Code用
│   │   │   │   ├── codex.ts      # Codex用
│   │   │   │   └── generic.ts    # 汎用
│   │   │   └── llm/          # LLM Adapter層
│   │   │       ├── types.ts      # 型定義
│   │   │       ├── adapter.ts    # LLMAdapter interface
│   │   │       ├── factory.ts    # プロバイダー選択
│   │   │       └── providers/    # mock, disabled
│   │   └── __tests__/        # テスト
│   └── web/              # フロントエンド (React + Vite)
└── docs/                 # ドキュメント (日英両対応)
```

## Tech Stack

- **Package Manager**: pnpm workspace
- **Backend**: TypeScript, node-pty, WebSocket (ws)
- **Frontend**: React 19, Vite 7, TypeScript
- **Test**: Vitest

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | サーバーとWebを同時起動 |
| `pnpm dev:server` | サーバーのみ起動 |
| `pnpm dev:web` | Web UIのみ起動 |
| `pnpm -C apps/server test` | サーバーのテスト実行 |

## Environment Variables

`apps/server/.env` で設定:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8787 | サーバーポート |
| `TARGET_CMD` | bash | 実行するCLIコマンド |
| `TARGET_ARGS` | (empty) | CLIへの引数（空白区切り） |
| `TARGET_CWD` | (cwd) | 作業ディレクトリ |
| `LOG_SOURCE` | auto | ルールセット選択 (auto/claude/codex/generic) |
| `LLM_PROVIDER` | disabled | LLMプロバイダー (disabled/mock/openai/anthropic/gemini) |
| `MOCK_LLM_MODE` | (empty) | `error` でmockがエラーを投げる（テスト用） |

## Architecture

```
[Target CLI] ──PTY──> [Server] ──WebSocket──> [Web UI]
                         │
                         ├── redact: マスキング処理
                         ├── extract: イベント抽出
                         └── comment: 実況生成（スタイル別）
```

- **PTY (node-pty)**: CLIを擬似端末で起動し出力をキャプチャ
- **WebSocket**: リアルタイムでWeb UIへブロードキャスト
- **Rate Limit**: 実況は最大2秒に1回（エラーは即時）

## Development Notes

- 実況スタイルはWeb UIから切り替え可能
- LOG_SOURCE=auto の場合、出力内容から自動でルールセット判定
- ローカル端末には生データ、Web UIにはマスク後データを送信

## LLM Adapter

- 設計ドキュメント: `docs/LLM_ADAPTER.ja.md`
- 実装: `apps/server/src/llm/`
- 現状は土台のみ（統合はまだ）
