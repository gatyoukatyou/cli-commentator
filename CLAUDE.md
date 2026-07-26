# cli-commentator

CLIの出力を別ウィンドウで実況するMVP

<!-- aion-ops bootstrap v2026-07-02 | 正本: gatyoukatyou/aion-ops | このブロックは編集せず雛形から再配布する -->

## 共通運用ルール（正本 = aion-ops）

このリポジトリの3AI運用（KURO / Gino / JEM ＋ HUMAN）の共通ルールは、
**すべて `gatyoukatyou/aion-ops` を唯一の正本（canonical）とする**。
ここには**ルール本体を書き写さない**。必ず正本を読むこと。矛盾時は aion-ops を優先し、迷えば停止してHUMAN確認。

### 起動時にやること（環境別）

- **ローカル版 Claude Code**：起動を `claude --add-dir ~/AION_Project/aion-ops` で行う。
  （aion-ops をローカルに未cloneなら1回だけ
  `git clone https://github.com/gatyoukatyou/aion-ops.git ~/AION_Project/aion-ops`）
- **Web版 Claude Code**：セッション作成時に、作業repoと `gatyoukatyou/aion-ops` を**同時に選択**する。
  単一repoセッションで aion-ops が見えない場合は、cloneで回避しようとせず、HUMANに複数repoセッションの作成を依頼する。

### 最初に読む正本（順に）

1. `aion-ops/docs/operations/minimal-operating-rules.md` — まず守る6項目（最上位サマリ）
2. `aion-ops/docs/operations/todoist-operation-rules.md` — Todoist運用（ボード・ラベル・ライフサイクル・権限境界）
3. `aion-ops/docs/operations/github-workflow.md` — GitHub運用
4. `aion-ops/agents/kuro-claude.md` — KUROの役割・境界
5. `aion-ops/templates/handoff-brief-template.md` — 節目ごとのhandoff書式（HUMAN判断待ちを最上段に置く）

### GitHub / Todoist の更新について

- 作業repoへの commit / PR / Issue は標準機能で行う。**main へ直接pushしない。mergeはHUMANのみ。**
- 節目のhandoffは `repo/handoff/status-YYYY-MM-DD.md` を正本とし、要約をTodoist親カードのコメントに投稿する。
  そのコメントは **Web版Claude と Gino（ChatGPT）が直接読む**（両者で実測済み。Gino向けの長文手動コピペは原則不要）。
- Todoist更新は、Claude Code にユーザースコープで Todoist MCP を追加済みであれば全repoで可能。
- 機微情報は GitHub・Todoist・handoff のいずれにも書かない。

<!-- /aion-ops bootstrap -->

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
│   │   │       └── providers/    # openai, groq, local, gemini, anthropic, mock, disabled
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
| `pnpm smoke:llm <provider>` | LLMプロバイダーのスモークテスト |

## Environment Variables

`apps/server/.env` で設定:

| Variable | Default | Description |
|----------|---------|-------------|
| `CLI_COMMENTATOR_PORT` | 8787 | サーバーポート（Tauri/Server/Web共通） |
| `PORT` | 8787 | サーバーポート（`CLI_COMMENTATOR_PORT`未設定時のフォールバック） |
| `INPUT_MODE` | pty | 入力モード (pty/file) |
| `INPUT_FILE` | (empty) | 監視対象ファイル（INPUT_MODE=file時に必須） |
| `TARGET_CMD` | bash (Win: powershell.exe) | 実行するCLIコマンド（PTYモード用） |
| `TARGET_ARGS` | (empty) | CLIへの引数（空白区切り） |
| `TARGET_ARGS_JSON` | (empty) | CLIへの引数（JSON配列、TARGET_ARGSより優先） |
| `TARGET_CWD` | (cwd) | 作業ディレクトリ |
| `LOG_SOURCE` | auto | ルールセット選択 (auto/claude/codex/generic) |
| `LLM_PROVIDER` | disabled | LLMプロバイダー (disabled/mock/openai/groq/local/gemini/anthropic) |
| `MOCK_LLM_MODE` | (empty) | `error` でmockがエラーを投げる（テスト用） |
| `COMMENT_TIMEOUT_MS` | 3000 | comment()のLLM呼び出しタイムアウト（ms） |
| `COMMENT_EXIT_TIMEOUT_MS` | 1500 | 終了時のcleanup強制実行までの待機時間（ms） |
| `PTY_USE_CONPTY` | (auto) | Windows ConPTY使用 (1/0、未設定時はデバッガ検知で自動判定) |

### INPUT_MODE の動作

| 値 | 動作 |
|----|------|
| 未設定 / `pty` | PTYモード：CLIを起動して出力をキャプチャ（デフォルト） |
| `file` | ファイル監視モード：`tail -f` でログファイルを監視（`INPUT_FILE` 必須） |
| その他 | 警告を出力してPTYモードにフォールバック |

**ファイル監視モードの使用例:**
```bash
# 外部プロセスのログを監視
INPUT_MODE=file INPUT_FILE=/var/log/app.log pnpm dev:server

# CIログを監視
INPUT_MODE=file INPUT_FILE=./ci-output.log pnpm dev:server
```

**バリデーション:**
- `INPUT_MODE=file` で `INPUT_FILE` が未設定 → エラー終了 (exit 1)
- `INPUT_MODE=file` で `INPUT_FILE` のファイルが存在しない → エラー終了 (exit 1)

### LLM_PROVIDER の動作

| 値 | 動作 |
|----|------|
| 未設定 / `disabled` | ルールベース実況のみ（LLM呼び出しなし） |
| `mock` | 決定論的モック応答（テスト用、`[mock-XXXX]` 形式） |
| `openai` | OpenAI API（要: `OPENAI_API_KEY`） |
| `groq` | Groq API（要: `GROQ_API_KEY`） |
| `local` | ローカルLLM（Ollama/vLLM等、OpenAI互換エンドポイント） |
| `gemini` | Google Gemini API（要: `GOOGLE_API_KEY`） |
| `anthropic` | Anthropic API（要: `ANTHROPIC_API_KEY`） |

**推奨構成（2026-07-26決裁）:** 実況と解説の両方でLLMプロバイダーを
明示的に選び、失敗時はルール版へ自動フォールバックさせる。プロファイルで
`ルール版のみ（LLMを使わない）` を選ぶか、`LLM_PROVIDER=disabled` を設定すれば
ルール版だけに固定できる。コードの既定値は `disabled` のままとし、利用者が
プロファイルごとに明示的に選ぶ方式を維持する。

判断時の実測では、`gemini-3.5-flash` が14/14件で
`COMMENT_TIMEOUT_MS=3000` 以内に成功し、レイテンシ中央値は約1.1秒だった。
この結果は `thinkingConfig.thinkingBudget=0` を適用した構成（PR #351）が前提。
方針決裁と比較結果は Issue #331 に記録している。

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
| `GEMINI_MODEL` | gemini-3.5-flash | 使用モデル（短文実況向けに思考を無効化） |

#### Anthropic (`LLM_PROVIDER=anthropic`)
| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | (required) | Anthropic APIキー |
| `ANTHROPIC_BASE_URL` | https://api.anthropic.com/v1 | APIエンドポイント |
| `ANTHROPIC_MODEL` | claude-3-5-sonnet-20240620 | 使用モデル |

**フォールバック仕様:** LLM呼び出しが失敗した場合（APIエラー/タイムアウト/空応答）、自動的にルールベース実況にフォールバック。

### LLM Smoke Test

```bash
# 単一プロバイダーテスト
pnpm smoke:llm openai
pnpm smoke:llm anthropic
pnpm smoke:llm gemini
pnpm smoke:llm groq
pnpm smoke:llm local
pnpm smoke:llm mock

# フォールバック確認（LLMエラー時）
MOCK_LLM_MODE=error pnpm smoke:llm mock

# 全プロバイダー一括（設定済みのみ実行）
pnpm smoke:llm --all
```

#### Exit Codes

| Code | 意味 |
|------|------|
| 0 | LLM応答成功 |
| 1 | 必須ENV未設定 |
| 2 | サーバー起動失敗 |
| 3 | コメントイベントなし |
| 4 | 無効なprovider引数 |
| 5 | フォールバック（LLM失敗→ルールベース） |

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

## Design Tokens & Skins

Web UIはCSSカスタムプロパティ（デザイントークン）でスタイリングされており、スキン切替に対応している。

### 利用可能なスキン

| スキン | 説明 |
|--------|------|
| `standard` | デフォルト。ダーク/ライトモードに対応 |
| `cli` | ダークなCLI風スタイル |

スキンはWeb UIのセレクターから切り替え可能。選択はlocalStorageに保存される。

### トークン構造

```
apps/web/src/
├── index.css    # トークン定義 + スキン上書き
└── App.css      # コンポーネントクラス定義
```

### 主要トークン

| カテゴリ | トークン例 |
|----------|-----------|
| 背景色 | `--color-bg-primary`, `--color-bg-secondary`, `--panel-bg` |
| 文字色 | `--color-fg-primary`, `--color-fg-secondary`, `--color-fg-muted` |
| アクセント | `--color-accent`, `--color-accent-hover` |
| セマンティック | `--color-success`, `--color-warning`, `--color-danger` |
| ボーダー | `--color-border`, `--color-border-strong` |
| シャドウ | `--shadow-sm`, `--shadow-md`, `--shadow-lg` |
| 角丸 | `--radius-sm`, `--radius-md`, `--radius-lg` |
| スペーシング | `--space-1` ~ `--space-8` |
| タイポグラフィ | `--text-sm`, `--text-base`, `--text-lg` |

### 新規UIを追加する際のガイドライン

1. **必ずトークン参照を使用** - 直書きの色コード禁止
2. **App.cssにクラス定義** - インラインスタイルはトークン参照のみ許可
3. **スキン切替テスト** - Standard/CLIで動作確認

```css
/* Good */
.my-component {
  background-color: var(--panel-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

/* Bad */
.my-component {
  background-color: #f5f5f5;
  border: 1px solid #ccc;
  border-radius: 8px;
}
```

## Typical Use Cases

### 1. PTYモード（デフォルト）
```bash
# Claude Codeの実況
TARGET_CMD="claude" TARGET_ARGS="code ." pnpm dev

# カスタムコマンドの実況
TARGET_CMD="npm" TARGET_ARGS="run build" pnpm dev
```

### 2. ファイル監視モード
```bash
# 外部プロセスのログを監視（プロセスは別で起動済み）
INPUT_MODE=file INPUT_FILE=/var/log/myapp.log pnpm dev:server

# 別ターミナルでWeb UIを起動
pnpm dev:web
```

### 3. Tauriデスクトップアプリ
```bash
# 開発モード（サーバー自動起動）
pnpm dev:desktop:managed

# DebugPanelでサーバー状態を確認
# - Desired/Actual state
# - PID
# - Crash/Orphan detection
```

## CI & Maintenance

- pnpm workspace では依存更新PRに `pnpm-lock.yaml` が必ず含まれること（無いと lockfile mismatch で CI が落ちやすい）
- Dependabot PR が DIRTY/CONFLICTING のまま `@dependabot rebase` が効かない場合は `@dependabot recreate` が有効なことがある
- このリポは merge commit 禁止 → **squash merge** を標準とする

## Session Exit Rule

**セッション終了前に必ず `/wrapup` を実行すること。**

- ユーザーが「終了」「おしまい」「ありがとう」等でセッション終了の意図を示した場合、まず `/wrapup` を実行してからセッションを終了する
- `/wrapup` を実行せずにセッションを終了してはならない
- SessionEnd hook が `/wrapup` 未実行を検出した場合、警告が表示される
