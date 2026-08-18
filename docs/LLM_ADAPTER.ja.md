# LLM Adapter 設計

## 概要
LLMプロバイダーを差し替え可能にするAdapter層。

## 環境変数

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | disabled | 使用するプロバイダー (disabled/mock/openai/opencode-go/groq/local/anthropic/gemini) |
| `MOCK_LLM_MODE` | (empty) | `error` でmockがエラーを投げる（テスト用） |
| `OPENCODE_GO_API_KEY` | (required) | OpenCode Go APIキー |
| `OPENCODE_GO_MODEL` | deepseek-v4-flash | OpenCode Goで使うモデル |
| `GOOGLE_API_KEY` | (required) | Gemini APIキー（`x-goog-api-key` ヘッダーで送信） |
| `GEMINI_MODEL` | gemini-3.5-flash | Geminiの使用モデル |

APIキーなどの資格情報は作業ツリー内に置かず、`apps/server/.env.example` をテンプレートにしてユーザー設定領域のenvファイルへ設定する。起動時にサーバーが外部ファイルを読み込むため、実体の `.env` をリポジトリ内へ作成しない。

## 現状
- factory と実況生成への統合は完了
- disabled / mock / OpenAI / OpenCode Go / Groq / local / Anthropic / Gemini を実装済み
- LLM呼び出しが失敗した場合は、文脈付きルールベース実況へフォールバック
- Geminiの既定モデルは、短文実況のレイテンシと出力完結性を優先して
  `thinkingConfig.thinkingBudget=0` を送信する
- 旧カスタムモデルとの互換性のため、思考無効化設定は対応モデルだけに送信する

## ファイル構成

```
apps/server/src/llm/
├── types.ts           # 型定義
├── adapter.ts         # LLMAdapter interface
├── factory.ts         # createLLMAdapter(env)
├── index.ts           # re-export
└── providers/
    ├── mock.ts          # 決定論的mock（テスト用）
    ├── disabled.ts      # 未設定時の明示的エラー
    ├── openai_compat.ts # OpenAI / OpenCode Go / Groq / local
    ├── opencode-go.ts   # OpenCode Go chat/completions
    ├── anthropic.ts     # Anthropic
    └── gemini.ts        # Gemini
```

## 使い方

```typescript
import { createLLMAdapter } from "./llm/index.js";

const adapter = createLLMAdapter();
// LLM_PROVIDER 未設定 → disabledAdapter (呼ぶとエラー)
// LLM_PROVIDER=mock → mockAdapter (決定論的レスポンス)
// LLM_PROVIDER=opencode-go → createOpenCodeGoAdapter (OPENCODE_GO_API_KEY が必要)
// LLM_PROVIDER=gemini → createGeminiAdapter (GOOGLE_API_KEY が必要)

const response = await adapter.generateText({
  messages: [{ role: "user", content: "Hello" }],
});

// response.model には、API応答またはリクエストで実際に使われたモデル名が入る
```

## 統合ポイント
`apps/server/src/commentary/orchestrator.ts` がLLM実況を呼び出し、失敗時は
ルールベース実況へフォールバックする。

Phase B評価では、この応答の `model` を `CommentMeasurement` 経由で集計する。
モデル名を評価スクリプト側で重複管理せず、計測が作られなかった実況は異常終了ではなく
`providerMetrics.skipped` として数える。`LLM_PROVIDER` は既知のプロバイダー名だけを受け付ける。

## テスト

```bash
pnpm -C apps/server test
```
