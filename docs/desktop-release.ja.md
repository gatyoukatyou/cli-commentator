<a href="desktop-release.ja.md"><kbd>日本語</kbd></a>
<a href="desktop-release.en.md"><kbd>English</kbd></a>

# Desktop配布ガイド（Tauri）

このページは、デスクトップ版の配布導線を整えるための実務チェックリストです。  
現時点では **Auto-start と更新確認（Updater check）は実装済み** で、Updater/配布自動化の土台をこのリポジトリに追加済みです。

## 現在の到達点

- Desktop Server パネルから Auto-start の有効/無効を切替可能
- Desktop Server パネルから Updater の更新確認（`更新を確認`）が可能
- `apps/desktop/src-tauri/tauri.conf.json` に Updater endpoint / artifact 生成設定を追加済み
- `.github/workflows/release-desktop.yml` でタグ起点の Draft Release 自動化を用意
- `desktop_check` CI（`cargo check` + `cargo test`）を毎PRで実行

## 1) 署名キーを準備する（Updater用）

Tauri Updater では署名が必須です。まず鍵ペアを生成します。

```bash
pnpm -C apps/desktop tauri signer generate -w ~/.tauri/cli-commentator-updater.key
```

生成物:

- `~/.tauri/cli-commentator-updater.key`（秘密鍵）
- `~/.tauri/cli-commentator-updater.key.pub`（公開鍵）

> 秘密鍵は絶対にリポジトリへコミットしないでください。

## 2) ビルド時の署名環境変数

CI/ローカルどちらでも、署名付きアップデートアーティファクトを作る場合は次を設定します。

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

例:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/cli-commentator-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="***"
```

GitHub Actions では同じ値を Repository Secrets に登録します。

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## 3) `tauri.conf.json` のUpdater設定（有効化時）

`apps/desktop/src-tauri/tauri.conf.json` は以下の形にします。

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "公開鍵の内容（.pubファイル）",
      "endpoints": [
        "https://github.com/gatyoukatyou/cli-commentator/releases/latest/download/latest.json"
      ]
    }
  }
}
```

`pubkey` には `tauri signer generate` で生成した公開鍵文字列（base64）を設定します。
署名鍵をローテーションした場合は `pubkey` も更新し、リリース検証を再実行してください。

## 4) タグ起点のリリースワークフロー

このリポジトリには `.github/workflows/release-desktop.yml` を追加済みです。

トリガー:

- 手動: `workflow_dispatch`
- タグ push: `v*`（例: `v0.1.0`）

ワークフロー内容:

1. lint/build/test を実行
2. macOS 2アーキテクチャ向け Tauri bundle を作成
3. Updaterアーティファクト付き Draft Release を作成

## 5) DesktopパネルでUpdater動作確認

`plugins.updater` を設定後、以下を確認します。

1. `pnpm dev:desktop:managed`
2. Desktop Server パネルで `更新を確認` をクリック
3. 次のいずれかが表示されることを確認
   - `Updater: 最新`
   - `Updater: 更新あり (vX.Y.Z)`
4. `Updater: 未設定` が出る場合は `tauri.conf.json` の `pubkey` / `endpoints` を再確認

## 6) 配布手順（最小）

1. バージョン更新（`tauri.conf.json` + 必要ならリリースノート）
2. `pnpm -C apps/web build`
3. `pnpm -C apps/desktop tauri:build`
4. タグ作成・push
   - `git tag -a vX.Y.Z -m "vX.Y.Z"`
   - `git push origin vX.Y.Z`
5. Draft Release の成果物を確認して Publish
6. リリース後、既存アプリで更新チェックを確認

## 7) 残タスク（次スプリント）

- macOS Notarization / Windows署名のCI化
- 配布対象確定後に macOS 以外のリリースマトリクス拡張
