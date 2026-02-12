<a href="release-runbook.ja.md"><kbd>日本語</kbd></a>
<a href="release-runbook.en.md"><kbd>English</kbd></a>

# Desktop Release Runbook v1

このRunbookは、タグ起点のDesktopリリースを安全に実行するための運用手順です。  
対象は `.github/workflows/release-desktop.yml` です。

## 0) 前提

- リポジトリ: `gatyoukatyou/cli-commentator`
- branch の変更は push 済み
- 次の Secrets が設定済み
  - `TAURI_SIGNING_PRIVATE_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  - `APPLE_CERTIFICATE`
  - `APPLE_CERTIFICATE_PASSWORD`
  - `KEYCHAIN_PASSWORD`
  - `APPLE_ID`
  - `APPLE_PASSWORD`
  - `APPLE_TEAM_ID`

## 1) リリース前チェック（必須）

### 1-1. ローカル検証

```bash
pnpm install
pnpm verify:updater
pnpm -C apps/web lint
pnpm -C apps/web build
CLI_COMMENTATOR_FORCE_NO_PTY=1 pnpm -C apps/server test
```

### 1-2. 検証の意味

- `pnpm verify:updater`
  - `apps/desktop/src-tauri/tauri.conf.json` の `plugins.updater.pubkey` 形式を検証
  - `TAURI_SIGNING_PRIVATE_KEY` がある場合、署名スモークで鍵ペア整合を検証

## 2) 標準リリース手順（Happy Path）

1. バージョンを更新（`apps/desktop/src-tauri/tauri.conf.json`）
2. コミット・push
3. タグ作成とpush
   - `git tag -a vX.Y.Z -m "vX.Y.Z"`
   - `git push origin vX.Y.Z`
4. Actions の `release-desktop` 実行を確認
5. Draft Release の成果物（署名付きUpdater artifacts）を確認
6. 問題なければ Draft を Publish

## 3) 障害時の復旧手順

### ケースA: `Verify updater key configuration` が失敗

症状:
- ワークフローが `verify-updater-config.mjs` で停止

対応:
1. `tauri.conf.json` の `plugins.updater.pubkey` が有効なbase64か確認
2. Secrets の `TAURI_SIGNING_PRIVATE_KEY` / `...PASSWORD` を確認
3. ローカルで `pnpm verify:updater` を実行して再現確認
4. 修正後、タグを切り直して再実行

### ケースB: `tauri-action` で署名/ビルド失敗

症状:
- `Build and draft release` ステップ失敗

対応:
1. Actionsログで失敗点（署名/ビルド/アップロード）を特定
2. Secretsと依存関係（lockfile含む）を確認
   - 特に `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `KEYCHAIN_PASSWORD`
3. 必要なら同一版タグを削除して再発行
   - `git tag -d vX.Y.Z`
   - `git push origin :refs/tags/vX.Y.Z`
   - 修正後に再度タグ作成

### ケースC: Draft Release に成果物が不足

症状:
- `latest.json` やプラットフォーム成果物が不足

対応:
1. workflow matrix の対象と `bundle.targets` を確認
2. 失敗runを修正後、タグ再実行
3. 不完全Draftは削除して作り直す

### ケースD: notarization失敗

症状:
- ビルド後にnotary関連エラーで失敗

対応:
1. `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` の値を確認
2. Apple側の認証状態（app-specific password失効等）を確認
3. Secrets更新後、タグを切り直して再実行

## 4) ロールバック指針

### Publish 前（推奨）

- Draftのまま不正成果物を破棄
- タグを削除して修正版で再発行

### Publish 後

1. 問題あるReleaseをGitHub上で明確化（タイトル/ノート追記）
2. 次の修正版 `vX.Y.(Z+1)` を最短で作成
3. 利用者向けに「更新保留」案内を出す

## 5) 監査ログ（最低限）

- 実行したタグ
- 実行workflow URL
- Publish判定者
- 異常時の原因と対応内容

この4点を残すと、次回の再現性が上がります。

## 6) 参考: 状態遷移ログの形式

Desktop server の状態遷移は次の形式でstderrへ出力されます。

```text
[desktop/server-event] {"ts":1739394000123,"trigger":"begin_start_transition","from":"stopped","to":"starting","operation_id":12,"pid":null,"port":8787,"detail":null}
```

主なフィールド:
- `trigger`: 遷移を起こした処理名
- `from` / `to`: 遷移前後の状態
- `operation_id`: start/stop系の操作単位ID
- `detail`: 失敗理由や補助情報（`exit_code` など）
