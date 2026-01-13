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
│   │   │       └── providers/    # openai, groq, local, gemini, mock, disabled
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
| `LLM_PROVIDER` | disabled | LLMプロバイダー (disabled/mock/openai/groq/local/gemini) |
| `MOCK_LLM_MODE` | (empty) | `error` でmockがエラーを投げる（テスト用） |
| `COMMENT_TIMEOUT_MS` | 3000 | comment()のLLM呼び出しタイムアウト（ms） |
| `COMMENT_EXIT_TIMEOUT_MS` | 1500 | 終了時のcleanup強制実行までの待機時間（ms） |

### LLM_PROVIDER の動作

| 値 | 動作 |
|----|------|
| 未設定 / `disabled` | ルールベース実況のみ（LLM呼び出しなし） |
| `mock` | 決定論的モック応答（テスト用、`[mock-XXXX]` 形式） |
| `openai` | OpenAI API（要: `OPENAI_API_KEY`） |
| `groq` | Groq API（要: `GROQ_API_KEY`） |
| `local` | ローカルLLM（Ollama/vLLM等、OpenAI互換エンドポイント） |
| `gemini` | Google Gemini API（要: `GOOGLE_API_KEY`） |
| `anthropic` | 未実装（フォールバックでルールベースに） |

### プロバイダー別環境変数

#### OpenAI (`LLM_PROVIDER=openai`)
| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | (required) | OpenAI APIキー |
| `OPENAI_BASE_URL` | https://api.openai.com/v1 | APIエンドポイント |
| `OPENAI_MODEL` | gpt-4o-mini | 使用モデル |

#### Groq (`LLM_PROVIDER=groq`)
| Variable | Default | Description |
|----------|---------|-------------|
| `GROQ_API_KEY` | (required) | Groq APIキー |
| `GROQ_BASE_URL` | https://api.groq.com/openai/v1 | APIエンドポイント |
| `GROQ_MODEL` | llama-3.3-70b-versatile | 使用モデル |

#### Local (`LLM_PROVIDER=local`)
| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_BASE_URL` | http://localhost:11434/v1 | APIエンドポイント（Ollama等） |
| `LOCAL_MODEL` | llama3.2 | 使用モデル |
| `LOCAL_API_KEY` | not-required | APIキー（不要な場合は省略可） |

#### Gemini (`LLM_PROVIDER=gemini`)
| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_API_KEY` | (required) | Google AI APIキー |
| `GEMINI_MODEL` | gemini-2.0-flash | 使用モデル |

**フォールバック仕様:** LLM呼び出しが失敗した場合（APIエラー/タイムアウト/空応答）、自動的にルールベース実況にフォールバック。

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
- macOS には `timeout` コマンドがない。代替方法:
  - `gtimeout`（`brew install coreutils`）
  - または `pnpm dev:server &` でバックグラウンド起動し、終了時は `kill %1`

## LLM Adapter

- 設計ドキュメント: `docs/LLM_ADAPTER.ja.md`
- 実装: `apps/server/src/llm/`
- `comment()` 関数で LLM_PROVIDER に応じて分岐（Sprint 6 で統合済み）
- タイムアウト保護: `comment()` は `COMMENT_TIMEOUT_MS` 後に自動でルールベースにフォールバック（Sprint 8）
- AbortController 対応: LLM リクエストに signal を渡して abort 可能（Sprint 8）
