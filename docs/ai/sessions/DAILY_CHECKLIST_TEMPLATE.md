# Sprint日次実行チェックリスト（テンプレート）

日付: `YYYY-MM-DD`
スプリント: `Sprint NN`
担当: `name`
ブランチ: `main`
Smokeタグ: `v0.0.0-smoke.YYYYMMDD-01`
Actions Run URL: `https://github.com/...`

---

## 0) 事前状態の固定

- [ ] `main` / `origin/main` 差分が `0/0`
- [ ] 作業ツリーが clean
- [ ] ローカル健全性チェック完了
  - [ ] `pnpm verify:updater`
  - [ ] `pnpm -C apps/web lint`
  - [ ] `pnpm -C apps/web build`
  - [ ] `CLI_COMMENTATOR_FORCE_NO_PTY=1 pnpm -C apps/server test`

## 1) Apple secrets の棚卸し（不足ゼロ化）

目的: signed/notarized 成果物の前提を揃える。

- [ ] GitHub を開く: `Settings -> Secrets and variables -> Actions`
- [ ] 必須キーを確認:
  - [ ] `APPLE_CERTIFICATE`
  - [ ] `APPLE_CERTIFICATE_PASSWORD`
  - [ ] `KEYCHAIN_PASSWORD`
  - [ ] `APPLE_ID`
  - [ ] `APPLE_PASSWORD`
  - [ ] `APPLE_TEAM_ID`
- [ ] 有無をメモへ記録
- [ ] 値の品質確認（typo/改行/期限切れ/空白）
- [ ] 不足分を追加し、追加内容をメモへ記録

メモ:
- `...`

## 2) 新しい smoke タグで `release-desktop` を再実行

目的: 追跡可能な成果物セットと Draft Release を1つ作る。

```bash
git tag -a v0.0.0-smoke.YYYYMMDD-01 -m "smoke YYYY-MM-DD #01"
git push origin v0.0.0-smoke.YYYYMMDD-01
```

- [ ] GitHub Actions で `release-desktop` 起動確認
- [ ] Run URL 保存
- [ ] arm64 成果物確認
- [ ] x64 成果物確認
- [ ] signed/unsigned 判定結果記録
- [ ] 失敗ログ要点を記録（失敗時）

## 3) Draft Release 成果物の実機スモークテスト

目的: 配布物として成立するかを確認する。

- [ ] ダウンロードとインストール成功
- [ ] 起動成功（Gatekeeper/notarization 挙動を観察）
- [ ] 主要画面が表示される
- [ ] 想定ユースケース1往復が通る
- [ ] 気づきは箇条書き記録（可能ならスクショ添付）

所見:
- `...`

## 4) ドキュメント更新

- [ ] `docs/release-runbook.ja.md` を更新
  - [ ] タグ名
  - [ ] Actions Run URL
  - [ ] 結果（signed/unsigned、成果物整合、所見）
- [ ] `docs/ROADMAP.ja.md` の Now/Next を当日状態へ更新
- [ ] （任意）スモークテストで見つかった不具合を Issue 化

## DoD

- [ ] Actions Run URL が残っている
- [ ] Draft Release 成果物（arm64/x64）を確認済み
- [ ] 実機テストメモ（良い/悪い/修正点）が残っている
- [ ] Runbook と Roadmap が当日状態に更新されている
