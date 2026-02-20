<a href="certificate-secrets.ja.md"><kbd>日本語</kbd></a>
<a href="certificate-secrets.en.md"><kbd>English</kbd></a>

# 証明書・Secrets運用ガイド（v1）

Desktop配布（署名/Notarization）で利用する証明書とSecretsの運用標準です。  
有償Apple証明書を導入しない期間の unsigned internal 運用もこのガイドで扱います。

## 1. 対象Secrets

| Secret | 用途 | 要件 |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Updaterアーティファクト署名 | 全モードで必須 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Updater秘密鍵パスワード | 全モードで必須 |
| `APPLE_CERTIFICATE` | macOSコード署名用 `.p12` のbase64 | signedモードで必須 |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` のエクスポート時パスワード | signedモードで必須 |
| `KEYCHAIN_PASSWORD` | CI一時keychain保護 | signedモードで必須 |
| `APPLE_ID` | notarization用 Apple ID | signedモードで必須 |
| `APPLE_PASSWORD` | notarization用 app-specific password | signedモードで必須 |
| `APPLE_TEAM_ID` | Developer Team ID | signedモードで必須 |

### 1-1. 有償証明書を導入しない期間の運用

- `APPLE_CERTIFICATE` 未登録時に `pnpm verify:apple-signing`（require mode）は Fail する
- 代わりに `pnpm verify:apple-signing:detect` を使い、不足Secretsの可視化だけを行う
- CIでは `v0.0.0-smoke.*` タグで unsigned internal 経路を使って継続検証する
- 通常の `vX.Y.Z` タグでは signedモード必須のため No-Go とする

## 2. ライフサイクル管理

### 2-1. 登録
1. 証明書を `.p12` でエクスポート
2. `base64` 変換して `APPLE_CERTIFICATE` に登録
3. 関連パスワードをSecretsへ登録
4. `pnpm verify:updater` / `pnpm verify:apple-signing`（require mode）とリリースworkflowで検証

#### 2-1-1. `APPLE_CERTIFICATE` 登録コマンド例

```bash
base64 < ./certs/developer-id-application.p12 | tr -d '\n' > /tmp/apple-certificate.base64
gh secret set APPLE_CERTIFICATE < /tmp/apple-certificate.base64
gh secret set APPLE_CERTIFICATE_PASSWORD
gh secret set KEYCHAIN_PASSWORD
gh secret set APPLE_ID
gh secret set APPLE_PASSWORD
gh secret set APPLE_TEAM_ID
```

登録後の形式チェック（同じシェルで値を展開して実行）:

```bash
APPLE_CERTIFICATE="$(cat /tmp/apple-certificate.base64)" \
APPLE_CERTIFICATE_PASSWORD="***" \
KEYCHAIN_PASSWORD="***" \
APPLE_ID="user@example.com" \
APPLE_PASSWORD="***" \
APPLE_TEAM_ID="ABCDEFGHIJ" \
pnpm verify:apple-signing
```

### 2-2. ローテーション
1. 新証明書/新鍵を発行
2. 先にSecretsを更新（古い値は即削除しない）
3. タグ起点のDraft Releaseで検証
4. 問題なければ旧証明書/旧鍵を失効・削除

### 2-3. 失効対応（インシデント）
1. 失効対象を特定（Updater鍵 / Apple証明書）
2. 該当Secretsを即時更新または無効化
3. 影響範囲（対象バージョン/配布物）を記録
4. 修正版リリースを優先発行

## 3. 権限モデル

最低限の分離:
- Secrets編集権限: Maintainer限定
- リリース実行権限: Maintainer + Release担当
- 通常開発者: 読み取りのみ（Secrets値は非公開）

レビュー原則:
- Secrets更新PRは少なくとも2名レビュー
- 更新理由と切替日時を記録

## 4. 監査チェックリスト

毎スプリント確認:
- [ ] 必須Secretsが全て存在する
- [ ] 失効済み証明書/鍵が削除されている
- [ ] 最新Runbookと運用が一致している
- [ ] 最近のリリース失敗原因が再発防止化されている

リリース前確認:
- [ ] `pnpm verify:updater` が成功
- [ ] release workflow の Secrets検証ステップが成功
- [ ] Draft Release の成果物が欠落していない

## 5. 記録テンプレ（推奨）

- 変更日時:
- 変更者:
- 変更対象Secrets:
- 理由:
- 検証Run URL:
- ロールバック手順:
