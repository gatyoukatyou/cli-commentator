<a href="release-runbook.ja.md"><kbd>日本語</kbd></a>
<a href="release-runbook.en.md"><kbd>English</kbd></a>

# Desktop Release Runbook v1

このRunbookは、タグ起点のDesktopリリースを安全に実行するための運用手順です。  
対象は `.github/workflows/release-desktop.yml` です。

関連ドキュメント:
- RC判定チェックリスト: `docs/release-rc-checklist.ja.md`
- RC判定証跡テンプレート: `docs/release-evidence-template.ja.md`
- RC判定証跡ログ: `docs/release-evidence-log.ja.md`
- 証明書/Secrets運用: `docs/certificate-secrets.ja.md`

## 0) 前提

- リポジトリ: `gatyoukatyou/cli-commentator`
- branch の変更は push 済み
- 必須 Secrets（常に必要）
  - `TAURI_SIGNING_PRIVATE_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- 任意 Secrets（release 作成権限の回避用）
  - `GH_RELEASE_TOKEN`（`contents:write` を持つ token。未設定時は `GITHUB_TOKEN` を使用）
- Apple署名/Notarizationを有効化する場合に必要な Secrets（任意）
  - `APPLE_CERTIFICATE`
  - `APPLE_CERTIFICATE_PASSWORD`
  - `KEYCHAIN_PASSWORD`
  - `APPLE_ID`
  - `APPLE_PASSWORD`
  - `APPLE_TEAM_ID`

### 0-1. 実行モード

- `Apple secrets あり`
  - 従来どおり署名 + notarization を実施
  - 正式配布候補の成果物を生成
  - `v0.0.0-smoke.*` タグでは signed/notarized 経路を実行しつつ、Draft Release は prerelease として内部証跡用に残す
- `Apple secrets なし`
  - workflow は unsigned internal モードで継続
  - `v0.0.0-smoke.*` タグのみ Draft Release を作成（内部検証用途）
  - 通常の `vX.Y.Z` タグではエラー終了し、署名モードを強制
- `release write 権限を確認できない（token未設定/権限不足）`
  - `v0.0.0-smoke.*` タグでは Draft Release の代わりに Actions artifact を出力して継続
  - 通常の `vX.Y.Z` タグではエラー終了（release 作成権限を必須化）

## 0.5) 最新ドライラン結果（2026-02-13）

- 実行タグ: `v0.0.0-smoke.5`
- workflow run: `https://github.com/gatyoukatyou/cli-commentator/actions/runs/21986062140`
- 結果:
  - `Verify updater key configuration` は arm64/x64 とも成功
  - `plugins.updater.pubkey` の key id と署名秘密鍵の key id が `0EDB9F95DB53F9FA` で一致
  - 当時は `Validate Apple signing/notarization secrets` で停止
  - 欠落Secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
  - 2026-02-13 更新後のworkflowでは、欠落時は unsigned internal モードで継続する

## 0.6) 最新ローカル事前検証（2026-02-18）と smoke再検証（2026-02-19）

- 対象コミット: `35262de`（`main`）
- 結果:
  - `pnpm verify:updater`: Pass（config-only、key id `0EDB9F95DB53F9FA`）
  - `pnpm -C apps/web lint` / `pnpm -C apps/web build`: Pass
  - `CLI_COMMENTATOR_FORCE_NO_PTY=1 pnpm -C apps/server test`: Pass
  - `failure_regression` 相当スイート: 34/34 Pass（`artifacts/failure-regression/summary.md`）
  - `pnpm smoke:desktop-distribution`: Pass
  - `pnpm verify:apple-signing`: Fail（`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` が未設定）
- 判定:
  - ローカル事前検証: Go
  - signed 配布判定: No-Go（`#138` 未解消、`release-desktop` signed 実行証跡なし）
- 追加実行（smoke tags）:
  - `v0.0.0-smoke.20260218-01`:
    - run: `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22138523276`
    - 結果: Failure（`binaries/node-aarch64-apple-darwin` / `binaries/node-x86_64-apple-darwin` 不足）
  - `v0.0.0-smoke.20260218-02`:
    - run: `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22138744883`
    - 結果: Cancelled
    - 内訳: arm64 build は bundle 生成まで成功したが、Draft Release 作成で `Resource not accessible by integration`
    - 内訳: x86 job は `macos-13-us-default` unsupported で起動不可
  - `v0.0.0-smoke.20260218-03`:
    - run: `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22139085837`
    - 結果: Failure
    - 内訳: arm64/x64 両方で bundle 生成は成功
    - 内訳: 両jobとも Draft Release 作成で `Resource not accessible by integration`
  - `v0.0.0-smoke.20260219-test`:
    - run: `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22185152032`
    - 結果: Success
    - 内訳: `Verify release publish permissions` は arm64/x64 両jobで成功（PR #186 の preflight 追加後）
    - 内訳: `GH_RELEASE_TOKEN` 未設定のため Draft Release は作成せず、token fallback artifact（`smoke-bundle-aarch64-apple-darwin` / `smoke-bundle-x86_64-apple-darwin`）を出力

## 0.7) 最新smoke実行（2026-02-20: GH release token 設定後）

- 実行タグ: `v0.0.0-smoke.20260220-211548`
- workflow run: `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22223734792`
- 結果:
  - `Verify release publish permissions`: Pass（arm64/x64 両job）
  - token source: `gh_release_token`（`GH_RELEASE_TOKEN` 使用）
  - `Build and draft release (unsigned internal)`: Pass（arm64/x64）
  - token fallback steps（`Resolve fallback target triple` / `Build smoke artifacts without Draft Release` / `Upload smoke artifacts`）は Skip
  - Draft Release: `isDraft=true`, `isPrerelease=true`, `tagName=v0.0.0-smoke.20260220-211548`
  - Draft Release assets: `latest.json` / `.app.tar.gz` / `.sig` / `.dmg` が arm64/x64 で生成
- 補足:
  - `gh secret list --repo gatyoukatyou/cli-commentator` 上で Apple secrets は `APPLE_CERTIFICATE` のみ未登録
  - signed/notarized 配布は引き続き `#138` の解消待ち

## 0.8) 現在の #138 署名 readiness snapshot（2026-05-09）

- Repository secrets:
  - 登録済み: `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
  - 未登録: `APPLE_CERTIFICATE`
- ローカル shell の確認:
  - `pnpm verify:apple-signing:detect` は現在の shell の環境変数だけを見る。GitHub repository secret 名の存在は見ない。
  - そのため、repository secrets が登録済みでも、ローカル実行では Apple secrets がすべて missing と表示されることがある。
- 残 blocker:
  - Developer ID Application certificate を private key 付きで `.p12` export
  - `.p12` を base64 化して `APPLE_CERTIFICATE` に登録
  - `.p12` export password を変える場合は `APPLE_CERTIFICATE_PASSWORD` も同時更新

## 1) リリース前チェック（必須）

### 1-1. ローカル検証

まずは1コマンド版（推奨）:

```bash
pnpm verify:internal-release
```

個別実行する場合:

```bash
pnpm install
pnpm verify:updater
GH_RELEASE_TOKEN=<token> pnpm verify:release-token --repo gatyoukatyou/cli-commentator
pnpm verify:apple-signing:detect
pnpm -C apps/web lint
pnpm -C apps/web build
CLI_COMMENTATOR_FORCE_NO_PTY=1 pnpm -C apps/server test
pnpm prepare:desktop-sidecar
pnpm -C apps/desktop tauri:build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
pnpm smoke:desktop-distribution
```

補足:
- `verify:internal-release` は Runbook の unsigned internal 検証手順を順番に実行するラッパー。
- `GH_RELEASE_TOKEN` 未設定時は `gh auth token` を自動利用する。
- `CLI_COMMENTATOR_FORCE_NO_PTY=1` では node-pty 必須ケース（`windows-fallback-integration` の restart `ptyError` 検証）は意図的に skip される。
- `pnpm smoke:desktop-distribution` は success path に加え、壊した `.app` コピーで `[sidecar_server_entry_missing]` が想定どおり検出されることも確認する。
- `verify:release-token` は `GH_RELEASE_TOKEN` 優先・未設定時は `GITHUB_TOKEN` を使用し、release write 権限を API で判定する。
- ローカルで `GITHUB_TOKEN` が無い場合は、`GH_RELEASE_TOKEN` を一時exportして実行する。
- `verify:apple-signing:detect` は不足Secretsを表示して 0 で終了する（無償期間の unsigned internal 運用向け）。
- signed配布を行う前には `pnpm verify:apple-signing`（require mode）を必ず Pass させる。

### 1-2. 検証の意味

- `pnpm verify:updater`
  - `apps/desktop/src-tauri/tauri.conf.json` の `plugins.updater.pubkey` 形式を検証
  - `TAURI_SIGNING_PRIVATE_KEY` がある場合、署名スモークで鍵ペア整合を検証

### 1-3. Updater 配布契約の検証

Release candidate が updater artifacts を生成する場合は、以下を確認します。

1. tag 作成前に `pnpm verify:updater` が Pass している。
2. Draft Release に以下が揃っている。
   - `latest.json`
   - macOS アーキテクチャごとの `.app.tar.gz`
   - 対応する `.app.tar.gz.sig`
   - 人間の初回導入用 `.dmg`
3. ダウンロードした release assets に bundle verifier を実行する。
   - `pnpm verify:desktop-bundle-artifacts <assets-dir> --require dmg --require app-tar-gz --require sig`
4. `latest.json` を確認する。
   - platform keys: `darwin-aarch64`, `darwin-aarch64-app`, `darwin-x86_64`, `darwin-x86_64-app`
   - 各 `url` の basename が存在する `.app.tar.gz` を指している
   - 各 `signature` が空でない
5. インストール済み Desktop app で Desktop Server パネルを開き、`更新を確認` をクリックする。
6. 更新確認が失敗した場合は `Copy Debug bundle` をクリックし、release evidence または issue comment に添付する。

現時点のポリシー: 更新確認は Desktop Server パネルからの手動操作です。起動時の自動更新確認がないことは release blocker として扱いません。

## 2) 標準リリース手順（Happy Path）

1. バージョンを更新（`apps/desktop/src-tauri/tauri.conf.json`）
2. コミット・push
3. タグ作成とpush
   - `git tag -a vX.Y.Z -m "vX.Y.Z"`
   - `git push origin vX.Y.Z`
4. Actions の `release-desktop` 実行を確認
5. Draft Release の成果物を確認
   - signedモード: 署名/notarization済み成果物
   - signed smokeモード（Apple secrets 登録済みの `v0.0.0-smoke.*`）: 署名/notarization済み成果物、`isDraft=true`、`isPrerelease=true`
   - unsignedモード: 内部検証用成果物（`Unsigned Smoke`, `isDraft=true`, `isPrerelease=true`; Gatekeeper警告あり）
   - updater契約: `latest.json` が存在する `.app.tar.gz` assets を指し、signature が空でない
6. 問題なければ Draft を Publish

## 2.5) Unsigned install cheats

現在の `release-desktop` smoke automation は macOS matrix から macOS artifacts（`.dmg`, `.app.tar.gz`, `.sig`）を生成する。Windows/Linux の手順は、ローカル build または将来の release matrix で該当 artifacts を生成した場合に使う。

### macOS unsigned install

1. `Unsigned Smoke` Draft Release から `.dmg` をダウンロード
2. `.dmg` を開く
3. `CLI Commentator.app` を `Applications` にドラッグ
4. Finder から起動

初回起動で macOS にブロックされた場合:

1. Finder で `CLI Commentator.app` を右クリック
2. `開く` を選ぶ
3. unsigned app の警告を確認して開く
4. それでもブロックされる場合は `システム設定` -> `プライバシーとセキュリティ` を開き、CLI Commentator の `このまま開く` を選ぶ

代表的な警告:

- `開発元を検証できないため開けません`: unsigned smoke builds では想定内。Finder の右クリック -> `開く` を使う。
- `未確認の開発元からのアプリケーション`: unsigned smoke builds では想定内。`プライバシーとセキュリティ` -> `このまま開く` を使う。
- `壊れているため開けません`: この repository release から取得した internal smoke artifact に限り quarantine を外して再試行する。

```bash
xattr -dr com.apple.quarantine "/Applications/CLI Commentator.app"
```

### Windows unsigned install

Windows artifacts を生成した場合:

1. `Unsigned Smoke` release から installer/archive をダウンロード
2. SmartScreen が出たら `詳細情報` を選ぶ
3. publisher が unknown/unsigned であることを確認し、`実行` を選ぶ
4. Microsoft Defender がブロックした場合は、この repository release から取得した artifact であることを確認してから、Defender prompt で許可して再試行する

### Linux unsigned install

Linux artifacts を生成した場合:

1. `Unsigned Smoke` release から archive または AppImage をダウンロード
2. AppImage 形式なら実行権限を付ける

```bash
chmod +x ./CLI-Commentator*.AppImage
```

3. 最初は terminal から実行し、startup error が見える状態で確認する

```bash
./CLI-Commentator*.AppImage
```

`.tar.gz` の場合は archive を展開し、展開先の executable を実行する。

## 3) 障害時の復旧手順

### ケースA: `Verify updater key configuration` が失敗

症状:
- ワークフローが `verify-updater-config.mjs` で停止

対応:
1. `tauri.conf.json` の `plugins.updater.pubkey` が有効なbase64か確認
2. Secrets の `TAURI_SIGNING_PRIVATE_KEY` / `...PASSWORD` を確認
3. ローカルで `pnpm verify:updater` を実行して再現確認
4. 修正後、タグを切り直して再実行

### ケースB: Apple secrets 不足で unsigned internal モードへフォールバック

症状:
- ログに `Apple signing/notarization disabled` が出る
- workflow は継続し、`Build and draft release (unsigned internal)` が実行される

対応:
1. 正式配布が必要なら `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `KEYCHAIN_PASSWORD` を登録
2. `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` を登録
3. 同じシェルに値を展開し `pnpm verify:apple-signing`（require mode）で形式検証
4. Secrets を追加後、新しいタグで signedモード実行を確認
   - `Detect Apple signing/notarization mode`: `enabled=true`
   - `Configure macOS keychain for code signing`: certificate import 成功
   - `Detect code signing identity`: Developer ID identity 検出
   - `Log notarization configuration`: 期待する Apple Team ID/account domain が表示される
   - `Build and draft release (signed + notarized)`: arm64/x64 両jobで成功
   - Draft Release assets に `latest.json`, `.app.tar.gz`, `.sig`, `.dmg` が揃う
5. 予算都合で未設定の場合は `pnpm verify:apple-signing:detect` で不足状態のみ確認
6. 予算都合で未設定の場合は内部検証用途として運用継続
   - unsigned 実行は `v0.0.0-smoke.*` タグでのみ可能

### ケースC: `tauri-action` で署名/ビルド失敗

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

### ケースD: Draft Release に成果物が不足

症状:
- `latest.json` やプラットフォーム成果物が不足

対応:
1. workflow matrix の対象と `bundle.targets` を確認
2. 失敗runを修正後、タグ再実行
3. 不完全Draftは削除して作り直す

### ケースE: notarization失敗

症状:
- ビルド後にnotary関連エラーで失敗

対応:
1. `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` の値を確認
2. Apple側の認証状態（app-specific password失効等）を確認
3. Secrets更新後、タグを切り直して再実行

### ケースF: Release作成で `Resource not accessible by integration`

症状:
- `tauri-action` が Draft Release 作成時に `Resource not accessible by integration` で失敗

対応:
1. リポジトリの Actions 権限（Workflow permissions）が `Read and write` か確認
2. `contents: write` が job で有効か確認
3. `GH_RELEASE_TOKEN=<token> pnpm verify:release-token --repo gatyoukatyou/cli-commentator` で release write 権限を事前確認
4. `GH_RELEASE_TOKEN`（`contents:write`）を設定し、workflow の `Verify release publish permissions` が `write_capable=true` になることを確認
5. 権限未確認のまま smoke 実行する場合は、`smoke-bundle-<target>` artifact が出力されることを確認
6. 組織/リポジトリルールで release 作成APIが制限されていないか確認
7. 権限修正後、新しいタグで再実行

### ケースG: matrix runner が unsupported で job が起動しない

症状:
- ジョブ注記に `The configuration '<runner-label>' is not supported` が出る

対応:
1. 対象リポジトリで利用可能な runner label へ置き換える
2. matrix の platform と target の組み合わせを見直す
3. 修正後、新しいタグで再実行

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
- RC判定証跡レコード（`docs/release-evidence-template.ja.md` 形式）
- `failure_regression` の要約（`failure-regression-logs/summary.md`）
- `failure_regression` の structured log 集計（`failure-regression-logs/structured-log-summary.json` と `failure-regression-logs/structured-log-captures/*.log`）

この5点を残すと、次回の再現性が上がります。

## 6) 参考: 状態遷移ログの形式

### 6-1) Desktop lifecycle

Desktop server の状態遷移は次の形式でstderrへ出力されます。

```text
[desktop/server-event] {"ts":1739394000123,"trigger":"begin_start_transition","from":"stopped","to":"starting","operation_id":12,"pid":null,"port":8787,"detail":null}
```

主なフィールド:
- `trigger`: 遷移を起こした処理名
- `from` / `to`: 遷移前後の状態
- `operation_id`: start/stop系の操作単位ID
- `detail`: 失敗理由や補助情報（`exit_code` など）

### 6-2) Server runtime（apps/server）

server プロセス側の状態遷移は次の形式でstdout/stderrへ出力されます。

```text
[server/state-event] {"ts":1739470000123,"trigger":"restart_fallback_file","from":"restarting","to":"file_running","inputMode":"file","profileId":"profile-1","detail":"fallback_reason=activated"}
```

主なフィールド:
- `trigger`: 遷移を発生させた処理名（例: `bootstrap`, `restart_begin`, `cleanup_complete`）
- `from` / `to`: serverランタイム状態の遷移
- `inputMode`: 遷移時の入力モード（`pty` / `file`）
- `profileId`: 対象プロファイルID（未指定時は `null`）
- `detail`: 追加コンテキスト（fallback理由、exit code、エラー要約など）

### 6-3) 時系列追跡コマンド（実運用）

```bash
# 1) server runtime の状態遷移のみ抽出
rg '^\[server/state-event\] ' <log-file> \
  | sed 's/^\[server\/state-event\] //'

# 2) desktop lifecycle の状態遷移のみ抽出
rg '^\[desktop/server-event\] ' <log-file> \
  | sed 's/^\[desktop\/server-event\] //'

# 3) 起動障害と状態遷移を同時に確認
rg '^\[(startup/failure|server/state-event|desktop/server-event)\] ' <log-file>
```

メモ:
- CI では `failure-regression-logs/summary.md` が `startup/failure` / `server/state-event` の集計を含み、詳細は `failure-regression-logs/structured-log-summary.json` と `failure-regression-logs/structured-log-captures/*.log` に出力される
- `<log-file>` には Actions artifact（例: `failure-regression-logs/structured-log-captures/startup-and-restart-fallback-activated.log` または `artifacts/failure-regression/console.log`）またはローカル実行のstdout/stderrログを指定
- まず `startup/failure` を見てから `server/state-event` / `desktop/server-event` を時系列で追うと切り分けしやすい

### 6-4) 失敗分類の対応表

`apps/server` の `[startup/failure]` と Desktop の `status.error` / `[desktop/server-event]` は別レイヤーです。前者は bundled server 自体の起動失敗ログ、後者は Tauri launcher の失敗文字列で、Web の recovery UI は主に後者を分類します。

| レイヤー | 主信号 | 代表カテゴリ | 使い方 |
| --- | --- | --- | --- |
| `apps/server` | `[startup/failure]` `code` | `node_pty_unavailable`, `target_command_not_found`, `target_cwd_not_found`, `target_permission_denied`, `invalid_target_args_json`, `input_file_missing`, `input_file_not_found`, `input_file_permission_denied` | `target.cmd` / `target.cwd` / `target.inputFile` / `port` / `fallback.reason` を見て server 側の再現条件を切り分ける |
| `apps/desktop` | `status.error` / `[desktop/server-event] detail` | `port_resolve`, `sidecar_manifest_*`, `sidecar_node_missing`, `sidecar_server_entry_missing`, `sidecar_server_root_missing`, `spawn`, `unexpected_exit`, `process_state`, `stop_process`, `wait_shutdown`, `inspect_before_stop` | 同梱物不足か、起動プロセス生成失敗か、起動後異常終了かを切り分ける |
| `apps/web` | recovery UI category | `ポート解決エラー`, `同梱ランタイムエラー`, `起動プロセス生成エラー`, `権限エラー`, `サーバープロセス異常終了`, `停止処理エラー`, `起動ディレクトリエラー` | 最初のアクションと確認コマンドをオペレータ向けに提示する |

運用メモ:
- `spawn` のうち `permission denied` は `権限エラー` に寄せ、それ以外の `spawn` は `起動プロセス生成エラー` として `node` / `entry` / `cwd` の確認に誘導する。
- `desktop_distribution_smoke` の failure path は `[sidecar_server_entry_missing]` を固定観点として持ち、UI の「同梱ランタイムエラー」分類と揃える。
