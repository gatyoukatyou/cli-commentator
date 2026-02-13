# cli-commentator AI Agent Instructions

## Project Identity
- **Project**: cli-commentator
- **Repository**: https://github.com/gatyoukatyou/cli-commentator
- **Type**: Node.js (pnpm workspace)
- **Tech Stack**: TypeScript, React, Vite, node-pty, WebSocket

## AI Team Roles

| Agent | Tool | Role |
|-------|------|------|
| KURO | Claude Code | 設計・実装（プライマリ） |
| Codex | OpenAI Codex CLI | レビュー・小規模修正 |
| JEM | Gemini CLI | 教育レポート・要約・UX助言 |

## Safety Guardrails

Before any read/write operation, verify:

```bash
test -f pnpm-workspace.yaml
git remote -v | grep -q "gatyoukatyou/cli-commentator"
```

### STOP IMMEDIATELY if any check fails
- Wrong remote (not cli-commentator)
- Not at repo root

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
