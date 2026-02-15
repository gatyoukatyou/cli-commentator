# AI Session Logs & Reports

## Directory Structure

```
docs/ai/
├── sessions/           # Raw session logs (gitignored)
│   ├── claude/         # KURO (Claude Code) session exports
│   ├── codex/          # Codex session logs
│   └── gemini/         # JEM (Gemini CLI) session logs
├── reports/            # Education reports (committed)
│   └── YYYY-MM-DD.md
└── README.md           # This file
```

## Sessions (gitignored)

生のセッションログ。機密情報を含む可能性があるため Git にコミットしない。

- **Claude Code**: `/wrapup` コマンドまたは SessionEnd hook で自動エクスポート
- **Codex**: 手動または `$dev-edu-report` skill 実行時に参照
- **Gemini CLI**: 手動エクスポート
- **日次テンプレート**: `docs/ai/sessions/DAILY_CHECKLIST_TEMPLATE.md` をコピーして日次メモとして利用

## Reports (committed)

非エンジニア向けの教育レポート。コミット対象。

- **生成者**: 主に JEM (Gemini CLI) または Codex の `$dev-edu-report` skill
- **フォーマット**: `YYYY-MM-DD.md`
- **内容**: 概要 / 変更点 / 背景 / 影響 / テスト / 用語解説 / 次アクション

## Checklists

- **運用チェックリスト**: `docs/ai/CHECKLIST.md`
  - Session終了時チェック
  - 教育レポート作成時チェック
- **サンプルレポート**: `docs/ai/reports/2026-02-15-sample.md`

## Recommended Workflow

1. Session終了時に `docs/ai/CHECKLIST.md` の 1) を確認
2. 必要に応じて日次メモを `docs/ai/sessions/DAILY_CHECKLIST_TEMPLATE.md` から作成
3. 教育レポート作成時に `docs/ai/CHECKLIST.md` の 2) を確認
4. `docs/ai/reports/` に日付ファイルで保存（コミット対象）
