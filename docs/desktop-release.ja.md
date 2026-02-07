<a href="desktop-release.ja.md"><kbd>日本語</kbd></a>
<a href="desktop-release.en.md"><kbd>English</kbd></a>

# Desktop配布ガイド（Tauri）

このページは、デスクトップ版の配布導線を整えるための実務チェックリストです。  
現時点では **Auto-start は実装済み**、**Updater/署名は手順整備フェーズ**です。

## 現在の到達点

- Desktop Server パネルから Auto-start の有効/無効を切替可能
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

## 3) `tauri.conf.json` のUpdater設定（有効化時）

有効化時は `apps/desktop/src-tauri/tauri.conf.json` に以下を設定します。

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "公開鍵の内容（.pubファイル）",
      "endpoints": [
        "https://example.com/cli-commentator/{{target}}/{{arch}}/{{current_version}}",
        "https://github.com/<owner>/<repo>/releases/latest/download/latest.json"
      ]
    }
  }
}
```

## 4) 配布手順（最小）

1. バージョン更新（`tauri.conf.json` + 必要ならリリースノート）
2. `pnpm -C apps/web build`
3. `pnpm -C apps/desktop tauri:build`
4. 生成されたバンドルと更新メタデータを配布先へ配置
5. リリース後、既存アプリで更新チェックを確認

## 5) 残タスク（次スプリント）

- Updaterを本番有効化（エンドポイント運用・鍵管理ポリシー確定）
- macOS署名/Notarization、Windows署名のCI化
- リリースワークフロー（タグ起点）をGitHub Actions化

