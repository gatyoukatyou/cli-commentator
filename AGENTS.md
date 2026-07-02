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
- スキン: Standard / Brutalism / Paper

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
