<a href="cross-platform-smoke-matrix.ja.md"><kbd>日本語</kbd></a>
<a href="cross-platform-smoke-matrix.en.md"><kbd>English</kbd></a>

# Cross-Platform Smoke Matrix

このドキュメントは、配布/運用で最低限維持するクロスプラットフォーム品質基準を定義します。

## 1) マトリクス定義

| Platform | 対象成果物 | 最小確認観点 | 合格条件 | 実行頻度 | 担当 |
|---|---|---|---|---|---|
| macOS arm64 | Desktop Draft Release artifact | 起動 / UI表示 / server接続 / 1往復実況 | 主要操作が完了し、クラッシュしない | リリース候補ごと | KURO |
| macOS x64 | Desktop Draft Release artifact | 起動 / UI表示 / updater設定認識 | 起動成功 + updater状態表示 | リリース候補ごと | KURO |
| Windows x64 | Desktop dev build (`cargo check/test`) | ビルド成立 / sidecar準備 / 起動経路 | CI `desktop_check` 緑 | PRごと | Codex |
| Linux x64 | Server + Web | `pnpm dev` 起動 / Web接続 / 実況表示 | `apps/server test` と `apps/web build` 緑 | PRごと | Codex |

## 2) 実行手順（最小）

1. 対象PRまたはタグのコミットSHAを記録
2. Matrix行ごとに実行し、結果をテンプレートへ記録
3. `Fail` が1つでもあれば、Issueを起票して `No-Go`
4. リリース候補は `Pass` のみで構成されることを確認

## 3) 記録フォーマット

```md
## Smoke Matrix Record: YYYY-MM-DD
- Target: <PR# or tag>
- Commit: <sha>
- Runner: <name>

| Platform | Result | Evidence |
|---|---|---|
| macOS arm64 | Pass/Fail/Skip | Actions URL or local notes |
| macOS x64 | Pass/Fail/Skip | Actions URL or local notes |
| Windows x64 | Pass/Fail/Skip | Actions URL or local notes |
| Linux x64 | Pass/Fail/Skip | Actions URL or local notes |

### Summary
- Go / No-Go
- Follow-up issues: #...
```

## 4) 2026-02 時点の現実運用

- PR単位:
  - `test`, `test_windows`, `desktop_check`, `desktop_distribution_smoke` をCIで確認
  - `desktop_distribution_smoke` では `pnpm smoke:desktop-distribution` を実行し、配布 `.app` から sidecar server を起動して `/healthz` と `comment_ok` ログを検証
- タグ/RC単位:
  - `release-desktop` 実行結果を `docs/release-runbook.*` と RC記録へ反映
- 補足:
  - Apple証明書未設定環境では unsigned internal モードを利用し、正式配布判定とは分離する
