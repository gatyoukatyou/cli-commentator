<a href="release-rc-checklist.ja.md"><kbd>日本語</kbd></a>
<a href="release-rc-checklist.en.md"><kbd>English</kbd></a>

# v0.2.0 RCチェックリスト

このドキュメントは、`v0.2.0` の RC（Release Candidate）判定を一定品質で実施するための基準と記録フォーマットを定義します。

関連ドキュメント:
- 判定証跡テンプレート: `docs/release-evidence-template.ja.md`
- 判定証跡ログ: `docs/release-evidence-log.ja.md`
- Desktop Release Runbook: `docs/release-runbook.ja.md`

## 1) Go/No-Go 判定項目

### A. 必須（1つでも NG なら No-Go）

- [ ] `main` に対する必須CIがすべて成功
- [ ] Desktop配布パスの最小検証（`desktop_distribution_smoke`）が成功
- [ ] Updater設定検証（`pnpm verify:updater`）が成功
- [ ] 主要ドキュメント（Getting Started / Desktop Release / Runbook / ROADMAP）が現状と一致
- [ ] 重大バグ（P0/P1）が未解決で残っていない

### B. 推奨（未達でも条件付き Go 可）

- [ ] 署名付き成果物の実機インストール確認（macOS）
- [ ] 既存インストールからの更新確認（Updater）
- [ ] 既知制約のユーザー向け注記が整備済み

## 2) 実行手順（最小）

1. 対象コミットと候補タグを決定（例: `v0.2.0-rc.1`）
2. `release-desktop` を実行し、Actions URLを記録
3. 成果物（`latest.json` / `.app.tar.gz` / `.sig` / `.dmg`）の存在を確認
4. 必須項目 A を判定し、Go/No-Go を決定
5. 判定結果を `docs/release-evidence-template.ja.md` のテンプレートで保存（末尾フォーマットは簡易版）

## 3) 判定記録フォーマット（簡易）

運用では `docs/release-evidence-template.ja.md` を優先し、以下は最小記録用として利用する。

```md
## RC Record: YYYY-MM-DD
- Candidate: v0.2.0-rc.N
- Commit: <sha>
- Reviewer: <name>
- Actions Run: <url>
- Decision: Go / No-Go

### Mandatory Checks (A)
- CI all green: Pass/Fail
- desktop_distribution_smoke: Pass/Fail
- verify:updater: Pass/Fail
- docs sync: Pass/Fail
- open P0/P1: Pass/Fail

### Recommended Checks (B)
- signed install smoke: Pass/Fail/Skip
- updater upgrade smoke: Pass/Fail/Skip
- known limitations note: Pass/Fail

### Notes
- <risk / follow-up / blocker>
```

## 4) 試行運用ログ（サンプル）

## RC Record: 2026-02-15
- Candidate: v0.2.0-rc.1 (dry-run)
- Commit: `main@2026-02-15`
- Reviewer: maintainers
- Actions Run: `release-desktop` latest dry-run
- Decision: Go (internal RC)

### Mandatory Checks (A)
- CI all green: Pass
- desktop_distribution_smoke: Pass
- verify:updater: Pass
- docs sync: Pass
- open P0/P1: Pass（Sprint 28 parent #141 closed）

### Recommended Checks (B)
- signed install smoke: Skip（`APPLE_CERTIFICATE` 設定作業中）
- updater upgrade smoke: Pass（設定確認パス）
- known limitations note: Pass

### Notes
- 正式外部配布前に `#138`（Apple certificate）完了が必要。
