<a href="manual-test-checklist.ja.md"><kbd>日本語</kbd></a>
<a href="manual-test-checklist.en.md"><kbd>English</kbd></a>

# 手動テストチェックシート（内部検証）

このチェックシートは、証明書未導入期間の人間テストを再現可能に実施するための最小手順です。

前提:
- 2026-02-20 時点では `APPLE_CERTIFICATE` 未登録のため、公開向け signed 配布判定は No-Go
- 本チェックは `v0.0.0-smoke.*` を使う internal 検証向け

## 1) 事前チェック（必須）

```bash
git switch main
git pull --ff-only
pnpm install
pnpm verify:internal-release
```

判定:
- [ ] `pnpm verify:internal-release` が `ALL CHECKS PASSED` で終了

## 2) Webモード手動テスト

ターミナルA:

```bash
: > /tmp/cc-human.log
INPUT_MODE=file INPUT_FILE=/tmp/cc-human.log LLM_PROVIDER=mock pnpm dev:server
```

ターミナルB:

```bash
pnpm dev:web
```

ターミナルC:

```bash
echo "gh pr checks --watch" >> /tmp/cc-human.log
echo "error: timeout while calling api" >> /tmp/cc-human.log
```

判定:
- [ ] Web UIにログと実況コメントが表示される
- [ ] エラー系ログ投入後も server が継続する

## 3) Desktop managed モード手動テスト

```bash
INPUT_MODE=file INPUT_FILE=/tmp/cc-human.log pnpm dev:desktop:managed
```

判定:
- [ ] Desktop Server パネルで `Start` / `Stop` が動作する
- [ ] 状態遷移が `stopped -> starting -> running` になる
- [ ] `更新を確認` クリック後に状態メッセージが更新される

## 4) 配布物（.app）起動テスト

```bash
pnpm prepare:desktop-sidecar
pnpm -C apps/desktop tauri:build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
open "apps/desktop/src-tauri/target/release/bundle/macos/CLI Commentator.app"
```

判定:
- [ ] `.app` が起動する
- [ ] Desktopパネルの操作と実況生成が可能

## 5) 記録テンプレート

```md
## Manual Test Record: YYYY-MM-DD
- Tester:
- Branch/Commit:
- Environment: macOS <version>

### Result
- Precheck (`pnpm verify:internal-release`): Pass/Fail
- Web mode manual: Pass/Fail
- Desktop managed manual: Pass/Fail
- Bundled .app launch: Pass/Fail

### Notes
- blockers:
- follow-up:
```

## 6) Go/No-Go 目安

- internal 検証:
  - [ ] 上記 1-4 がすべて Pass なら Conditional Go
- 公開向け signed 配布:
  - [ ] `APPLE_CERTIFICATE` 未登録の間は No-Go を維持

