<a href="docs-update-flow.ja.md"><kbd>日本語</kbd></a>
<a href="docs-update-flow.en.md"><kbd>English</kbd></a>

# ROADMAP / LLM_ADAPTER 更新フロー

## 目的

`docs/ROADMAP.*` と `docs/LLM_ADAPTER.ja.md` の更新漏れを減らし、実装と公開ドキュメントの鮮度を保つ。

## 対象ドキュメント

- `docs/ROADMAP.ja.md`
- `docs/ROADMAP.en.md`
- `docs/LLM_ADAPTER.ja.md`

## 更新タイミング

以下のいずれかに当てはまるPRでは、原則として対象ドキュメントの更新要否を判定する。

- スプリントの開始/完了、優先順位、Now/Next を変える変更
- LLM プロバイダー、フォールバック仕様、環境変数、契約を変える変更
- Desktop 配布や CI ガードなど、運用手順や品質ゲートを変える変更

## 役割と責任

- PR作成者（必須）
  - 変更内容に応じて更新対象を判断する
  - 必要なドキュメントを同一PRで更新する
  - 更新不要の場合は PR Summary に理由を明記する
- レビュアー（必須）
  - 実装差分と対象ドキュメントの整合性を確認する
  - 更新漏れがあれば修正要求する
- マージ担当（任意）
  - squash 後に関連Issue/PR履歴が ROADMAP 上で追跡可能か確認する

## PR運用ルール

`.github/pull_request_template.md` の Doc Freshness チェックを利用し、以下を必須化する。

- 更新あり: 更新したドキュメントのパスを Summary に記載
- 更新なし: 更新不要の理由を Summary に記載

## レビュー観点（最小）

- ROADMAP の `Current status` / `Now` / `Next` は当日状態か
- ROADMAP 日英の内容が同期しているか
- LLM_ADAPTER のプロバイダー一覧・環境変数・挙動が実装と一致しているか
- 実装変更が docs 未反映のまま残っていないか

## 運用メモ

- docs 更新は「後でまとめる」ではなく、変更PRに同梱する。
- Sprint 親Issueを閉じる前に ROADMAP の差分を最終確認する。

## CIガード（Issue #132）

- GitHub Actions workflow file の静的検証として、PR と `main` push で `actionlint` を実行する。
- PR では `docs_drift_guard` ジョブが `scripts/check-doc-sync.mjs` を実行する。
- ローカル実行では commit 済み、stage 済み、未stage、untracked の差分を対象にする。
- 対象実装（LLM/desktop配布系）が変わったのに主要docsが未更新の場合、CI は失敗する。
- `apps/desktop/src-tauri/Cargo.lock` のみの依存更新は、運用手順を変更しないため desktop 配布docsの同期対象外とする。desktopコード・設定・CI・release workflowは引き続き対象とする。
- 例外運用が必要な場合のみ、PR本文に `[skip-doc-sync-check]` を明記し、理由を添える。

### CI action maintenance

- `pnpm/action-setup` は CI/runtime action dependency として保守する。v5 系への
  更新により action runtime は Node.js 24 になるが、このリポジトリで固定している
  pnpm version、desktop release workflow の構成、署名フロー、updater 設定、
  operator-facing なリリース手順は変更しない。
