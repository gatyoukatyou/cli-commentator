# LLM Adapter 設計

## 概要
LLMプロバイダーを差し替え可能にするAdapter層。

## 環境変数

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | disabled | 使用するプロバイダー (disabled/mock/openai/anthropic/gemini) |
| `MOCK_LLM_MODE` | (empty) | `error` でmockがエラーを投げる（テスト用） |

## 現状
- **統合はまだ行っていない**
- factory + mock + disabled のみ実装
- openai/anthropic/gemini は未実装（呼ぶとエラー）

## ファイル構成

```
apps/server/src/llm/
├── types.ts           # 型定義
├── adapter.ts         # LLMAdapter interface
├── factory.ts         # createLLMAdapter(env)
├── index.ts           # re-export
└── providers/
    ├── mock.ts        # 決定論的mock（テスト用）
    └── disabled.ts    # 未設定時の明示的エラー
```

## 使い方

```typescript
import { createLLMAdapter } from "./llm/index.js";

const adapter = createLLMAdapter();
// LLM_PROVIDER 未設定 → disabledAdapter (呼ぶとエラー)
// LLM_PROVIDER=mock → mockAdapter (決定論的レスポンス)

const response = await adapter.generateText({
  messages: [{ role: "user", content: "Hello" }],
});
```

## 将来の統合ポイント
`apps/server/src/styles/index.ts` の `comment()` 関数で、
ルールベース実況の代わりにLLMを呼ぶ分岐を追加予定。

## テスト

```bash
pnpm -C apps/server test
```
