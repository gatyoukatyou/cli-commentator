# cli-commentator AI Agent Instructions

<!-- aion-ops bootstrap v2026-07-02 | 正本: gatyoukatyou/aion-ops -->

## 共通運用ルール（正本 = aion-ops）

このリポジトリの3AI運用（KURO / Gino / JEM + HUMAN）の共通ルールは、`gatyoukatyou/aion-ops` を唯一の正本とする。

作業開始時は、まず次を確認する。

1. `aion-ops/docs/operations/minimal-operating-rules.md`
2. `aion-ops/docs/operations/todoist-operation-rules.md`
3. `aion-ops/docs/operations/github-workflow.md`
4. `aion-ops/agents/kuro-claude.md`
5. `aion-ops/templates/handoff-brief-template.md`

ここにはルール本体を書き写さない。矛盾時は aion-ops を優先し、迷えば停止してHUMAN確認。
mainへ直接pushしない。mergeはHUMANのみ。

<!-- /aion-ops bootstrap -->

## Project Identity
- **Project**: cli-commentator
- **Repository**: https://github.com/gatyoukatyou/cli-commentator
- **Type**: Node.js (pnpm workspace)
- **Tech Stack**: TypeScript, React, Vite, node-pty, WebSocket

## AI Team Roles

| Agent | Tool | Role |
|-------|------|------|
| KURO | Claude Code | 現場把握・全体構想・実装/PR主担当 |
| Gino | ChatGPT / Codex | HUMAN相談役・別視点検証・軽量PR補助 |
| JEM | Gemini / NotebookLM | 資料読解・翻訳・要約・UX助言 |

## Safety Guardrails

Before any read/write operation, verify repo identity:

```bash
# 1) Marker check (works in all environments, including cloud sandboxes)
test -f pnpm-workspace.yaml
grep -q '"name": "cli-commentator"' package.json

# 2) Remote check (only applies when a remote is configured)
git remote -v
```

Remote check rules:
- If `git remote -v` outputs one or more remotes, they MUST contain `gatyoukatyou/cli-commentator`.
- If no remote is configured (e.g. Codex Cloud / CI sandboxes mount the repo without remotes), rely on the marker check above and proceed.

### STOP IMMEDIATELY if
- Marker check fails (wrong repo or not at repo root)
- A remote exists but does not match `gatyoukatyou/cli-commentator`

## Forbidden Directories
- `~/actions-runner/_work/*` (CI/CD only)

## Project Overview

CLIの出力を別ウィンドウで実況するMVP。PTY経由でCLI出力をキャプチャし、WebSocket経由でWeb UIにリアルタイム配信する。

### Architecture
```
[Target CLI] --PTY--> [Server] --WebSocket--> [Web UI]
                        |
                        +-- redact: マスキング処理
                        +-- extract: イベント抽出
                        +-- comment: 実況生成（スタイル別）
```

### Key Features
- PTY (node-pty) によるCLI出力キャプチャ
- 実況スタイル: 標準 / 関西弁 / ずんだもん風
- LLM Adapter: OpenAI, Groq, Gemini, Anthropic, local (Ollama)
- スキン: Standard / CLI

## Conventions

### Commits
- Format: Conventional Commits (feat:/fix:/docs:/chore:)

### Branches
- Naming: `feat/`, `fix/`, `docs/` prefixes

### Merge Strategy
- squash merge を標準とする

## Common Commands

```bash
# Development
pnpm install
pnpm dev              # サーバー + Web UI 同時起動

# Testing
pnpm -C apps/server test

# LLM Smoke Test
pnpm smoke:llm <provider>
```

## Key Documents

- `CLAUDE.md` - Project context for Claude
- `docs/LLM_ADAPTER.ja.md` - LLM Adapter設計ドキュメント
- `docs/ROADMAP.ja.md` - ロードマップ
- `README.md` - Project overview

## Approvals

**Auto-approve (no confirmation needed):**
- File reads, writes, edits
- pnpm commands
- Build, test, lint commands

**Must request approval:**
- `git add`, `git commit`, `git push`
- `gh pr create`, `gh pr merge`
- `gh issue`, `gh release`

## Review guidelines

### 出力の形式

- 指摘は重要度の高い順に**最大5件**。少なくてよい。指摘がなければ「指摘なし」とだけ書く。
- 1件あたり**日本語で4行以内**。長い説明より短い断定を優先する。
- 前置き（「このPRを拝見しました」等）、励まし（「全体的にきれいなコードです」等）、末尾の総括は書かない。
- 全体の要約が必要な場合は、指摘の前に**3行以内**で書く。

### 各指摘に含める3点

1. **現象** — この変更によって何が起きるか。利用者やシステムから見える形で書く。
2. **影響** — 放置した場合の被害と、その深刻さ（高／中／低）。
3. **対処** — 修正案、または元に戻す手順。手順がある場合はコマンドや操作を具体的に示す。

### 日本語の文体

このリポジトリの読み手はエンジニアではありません。用語を避けるのではなく、用語に注釈をつけてください。

**基本ルール**

- 敬体（です・ます調）で書く。
- 一つの文に一つの意味だけを入れる。「〜で、〜のため、〜ですが、〜です。」のような複文は書かない。
- 主語を省略しない。「表示が崩れます」ではなく「ログイン画面の表示が崩れます」。何が・どこが、を必ず書く。
- 能動態で書く。「データが削除される可能性がある」ではなく「この処理が既存データを削除する」。

**専門用語の扱い**

- 専門用語は正確な用語をそのまま使う。言い換えや比喩で置き換えない。
- **初出時のみ**、用語の直後に「（＝一行の説明）」を添える。2回目以降は注釈なしで使う。
- 例：「レースコンディション（＝2つの処理が同時に走り、順序次第で結果が変わる状態）が発生します。」

**避けるべき表現**

| 避ける | 代わりに使う |
|---|---|
| 〜の可能性があります | 〜します／〜する恐れがあります |
| 問題ないかと思われます | 問題ありません／未確認です |
| 〜した方がいいかもしれません | 〜してください／〜を推奨します |
| 念のため確認をお願いします | （具体的に）〜を確認してください |
| 体言止め（「表示崩れ。」） | 述語で終える（「表示が崩れます。」） |

**確信度の表記**

- 確信がある指摘はそのまま断定する。
- 確信が持てない指摘は文末に **[未確認]** と書く。推測を断定形で書かない。
- 「たぶん」「おそらく」「〜と思われます」は使わない。断定か [未確認] かの二択。

---

## 指摘の優先順位

次の順で重要度を判定してください。下位の項目のために上位の指摘枠を使わないでください。

1. データが失われる、または復旧できなくなる変更
2. 認証・権限・秘密情報の扱いに関わる変更
3. 既存の利用者に見える形で動作が変わる変更
4. 元に戻す手順が単純でない変更
5. 上記に該当しない不具合

**スタイル、命名、整形に関する指摘は行わないでください。** これらは自動整形ツールの担当です。
