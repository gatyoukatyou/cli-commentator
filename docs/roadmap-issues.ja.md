<a href="roadmap-issues.ja.md"><kbd>日本語</kbd></a>
<a href="roadmap-issues.en.md"><kbd>English</kbd></a>

# ロードマップ Issue 下書き（Sprint 14-21）

## 使い方
1. 各Issueの `Title` をそのまま使う
2. 各Issueの `Body` を貼り付けて担当者・期限を追記する
3. ラベル例: `roadmap`, `sprint-14`, `area/release`

## Sprint 14（2026-02-12 〜 2026-02-25）

### 14-1
**Title**
`release: updater公開鍵を実値へ更新し検証フローを追加`

**Body**
```md
## Summary
Updater公開鍵のプレースホルダーを実値へ置き換え、更新署名の検証フローを固定する。

## Scope
- 公開鍵の安全な反映手順を実装する
- 署名検証の実行手順をRunbookへ追加する

## Tasks
- [ ] 公開鍵反映手順を実装
- [ ] 検証コマンドを整備
- [ ] 手順をdocsへ反映

## Definition of Done
- 実タグ起点で署名検証が成功する
- 失敗時の復旧手順が文書化されている
```

### 14-2
**Title**
`ci: タグ起点で署名付きDraft Releaseを自動生成`

**Body**
```md
## Summary
タグPushをトリガーに署名付きのDraft Releaseを自動生成するワークフローを整備する。

## Scope
- タグ起点のCIジョブを実装する
- 生成物と署名をDraft Releaseへ添付する

## Tasks
- [ ] リリースworkflowを更新
- [ ] 署名/添付処理を追加
- [ ] 失敗時通知を整備

## Definition of Done
- タグ作成でDraft Releaseが自動作成される
- 署名付き成果物が確認できる
```

### 14-3
**Title**
`docs: リリースRunbook v1（復旧/ロールバック手順を含む）`

**Body**
```md
## Summary
運用者向けにリリースRunbook v1を作成し、復旧とロールバックを明文化する。

## Scope
- 正常系手順の整理
- 代表障害時の復旧/ロールバック手順の追加

## Tasks
- [ ] 正常系フローを文書化
- [ ] 失敗ケース別の復旧手順を追加
- [ ] 参照リンクをROADMAPへ追加

## Definition of Done
- 新規担当者がRunbookのみでリリース可能
- ロールバック判断基準が記載されている
```

## Sprint 15（2026-02-26 〜 2026-03-11）

### 15-1
**Title**
`desktop: macOSコード署名をCIフローへ統合`

**Body**
```md
## Summary
macOS向け成果物のコード署名をCIに統合し、手作業依存を減らす。

## Scope
- CIで署名可能な設定へ移行
- Secrets参照と失敗時ログを整備

## Tasks
- [ ] 署名設定をCIへ反映
- [ ] Secrets参照チェックを追加
- [ ] 署名失敗時のログ改善

## Definition of Done
- CI経由で署名済み成果物を継続生成できる
- 署名失敗時の原因切り分けが可能
```

### 15-2
**Title**
`desktop: notarization submit/staple を自動化`

**Body**
```md
## Summary
notarizationのsubmit/staple手順を自動化し、配布前作業を定常運用にする。

## Scope
- submit/stapleの自動実行
- 実行結果のログ出力

## Tasks
- [ ] submit処理を自動化
- [ ] staple処理を自動化
- [ ] 失敗時の再実行手順を整備

## Definition of Done
- 署名後にnotarizationまで連続実行できる
- 結果をCIログで追跡できる
```

### 15-3
**Title**
`docs: 証明書・Secrets運用ガイドを整備`

**Body**
```md
## Summary
証明書とSecretsの登録・更新・失効対応を運用ガイドとして整備する。

## Scope
- 証明書ライフサイクル管理
- Secrets更新手順と監査観点の明文化

## Tasks
- [ ] 更新手順を文書化
- [ ] 権限モデルを定義
- [ ] 監査チェック項目を追加

## Definition of Done
- 証明書更新時の作業が標準化されている
- 権限漏れなく運用できる
```

## Sprint 16（2026-03-12 〜 2026-03-25）

**Status（2026-05-08）**
- Done
  - `server: 起動失敗の原因分類ログを強化` は main 反映済み（PR #213）
  - `qa: クリーン環境向け配布物スモークテストを追加` は CI 反映済み。negative path を含む `desktop_distribution_smoke` が green
  - recovery guidance の既知カテゴリ coverage、commentary noise 抑止、入力/TTS UX 改善も main 反映済み（PR #217-#219）
  - `#214` は closed。Sprint 16 の done / remaining / blocked 再整理を完了
  - `#215` は closed。`要確認` は未知 / 非構造化エラー用 fallback として維持し、`spawn` 細分類は具体例が出るまで保留と整理
- Remaining
  - 具体的な recovery 例が新しく出た場合は、通常の evidence log で継続収集する
- Blocked / Deferred
  - signed/notarized 配布 readiness は `#138` 依存（Apple Developer ID certificate、GitHub Secrets、notarization validation）
  - clean internal 実機証跡は CI 証跡とは別管理

### 16-1
**Title**
`qa: クリーン環境向け配布物スモークテストを追加`

**Body**
```md
## Summary
クリーン環境でのインストールから初回起動までを確認するスモークテストを追加する。

## Scope
- 配布物インストール
- 初回起動と実況開始確認

## Tasks
- [x] テスト手順を定義
- [x] 代表環境で実行（GitHub CI `desktop_distribution_smoke`）
- [x] 失敗パターンを記録（negative path: `sidecar_server_entry_missing`）

## Definition of Done
- install -> launch -> commentary start が再現できる
- 失敗時の再現条件が記録される
```

### 16-2
**Title**
`desktop: 起動失敗時の復旧ガイドUIを改善`

**Body**
```md
## Summary
起動失敗時の復旧アクションをDesktopパネル上で分かりやすく案内する。

## Scope
- 失敗メッセージの分類表示
- 復旧手順の即時提示

## Tasks
- [x] エラー文言を分類
- [x] 復旧ガイド文言を更新
- [x] 既知カテゴリの回帰テストを追加
- [ ] `要確認` に落ちる実例を棚卸しする
- [ ] `spawn` 細分類を次 Sprint に送るか判断メモを残す

## Definition of Done
- 主要失敗ケースで復旧手順を提示できる
- ユーザーが次アクションを判断できる
```

### 16-3
**Title**
`server: 起動失敗の原因分類ログを強化`

**Body**
```md
## Summary
サーバー起動失敗の原因を分類可能なログ構造へ改善する。

## Scope
- 原因カテゴリ付与
- 復旧に必要なコンテキスト出力

## Tasks
- [x] ログ項目を設計
- [x] 分類ロジックを実装
- [x] テストを追加

## Definition of Done
- 代表障害の原因をログのみで判別できる
- 既存ログ互換を維持する
```

## Sprint 17（2026-03-26 〜 2026-04-08）

### 17-1
**Title**
`server: 状態遷移ログを構造化して収集可能にする`

**Body**
```md
## Summary
状態遷移ログを構造化し、障害時の時系列追跡を容易にする。

## Scope
- 状態遷移イベントの共通形式化
- 収集先への連携しやすい出力

## Tasks
- [ ] イベントスキーマを定義
- [ ] 出力実装を更新
- [ ] テスト/サンプルを整備

## Definition of Done
- 状態遷移を時系列で追える
- 想定収集先に取り込み可能
```

### 17-2
**Title**
`test: node-pty unavailable のフォールバックE2Eを拡充`

**Body**
```md
## Summary
node-pty unavailable時のフォールバック挙動をE2E観点で拡充する。

## Scope
- 起動時フォールバック
- 再起動経路フォールバック

## Tasks
- [ ] E2Eシナリオを追加
- [ ] 契約メッセージを検証
- [ ] 回帰ケースを固定

## Definition of Done
- fallback経路の主要ケースを自動検証できる
- `ptyUnavailable` 契約の回帰を検知できる
```

### 17-3
**Title**
`ci: 障害シナリオの回帰テストジョブを追加`

**Body**
```md
## Summary
障害シナリオ専用の回帰テストジョブをCIに追加する。

## Scope
- 障害シナリオの定常実行
- 失敗時の原因特定情報の出力

## Tasks
- [ ] 新規CIジョブを追加
- [ ] 対象テストを選定
- [ ] レポート出力を整備

## Definition of Done
- PR時に障害回帰が検知できる
- 失敗時に追跡可能なログが残る
```

## Sprint 18（2026-04-09 〜 2026-04-22）

### 18-1
**Title**
`rulesets: detect誤判定ケースを追加し閾値を調整`

**Body**
```md
## Summary
detect誤判定ケースをfixture化し、閾値調整で判定精度を改善する。

## Scope
- 誤判定ログの追加
- 閾値・ルール調整

## Tasks
- [ ] fixtureを追加
- [ ] 判定ロジックを調整
- [ ] 回帰テストを更新

## Definition of Done
- 代表ケースで誤判定率が低下する
- 既存成功ケースを壊さない
```

### 18-2
**Title**
`styles: 初心者向け1行説明テンプレートを改善`

**Body**
```md
## Summary
初心者向け1行説明テンプレートを見直し、理解しやすい実況文へ改善する。

## Scope
- 口調ごとのテンプレート更新
- 用語注釈ルールの改善

## Tasks
- [ ] テンプレート草案を作成
- [ ] 実ログで評価
- [ ] 採用案を実装

## Definition of Done
- 代表シナリオで可読性評価が改善する
- 口調ごとの差異を維持する
```

### 18-3
**Title**
`test: 実況品質fixtureとsnapshotを拡充`

**Body**
```md
## Summary
実況品質を守るためのfixture/snapshotを拡充する。

## Scope
- 品質評価向けfixture追加
- snapshotの見直し

## Tasks
- [ ] fixtureを追加
- [ ] snapshotを更新
- [ ] 期待値レビューを実施

## Definition of Done
- 品質退行をテストで検出できる
- snapshotの意図が追える
```

## Sprint 19（2026-04-23 〜 2026-05-06）

### 19-1
**Title**
`web: 用語注釈の見せ方を改善（読みやすさ優先）`

**Body**
```md
## Summary
用語注釈の表示方法を改善し、初心者の読みやすさを向上する。

## Scope
- 注釈表示のレイアウト調整
- 視認性改善

## Tasks
- [ ] 現状課題を整理
- [ ] UI案を実装
- [ ] 主要画面で確認

## Definition of Done
- 注釈を読んでも主文を見失いにくい
- モバイル/デスクトップで崩れない
```

### 19-2
**Title**
`web: 実況ログの最低限フィルタ/検索を追加`

**Body**
```md
## Summary
長時間利用時に追跡しやすいよう、実況ログの最低限フィルタ/検索を追加する。

## Scope
- キーワード検索
- 最小限の絞り込み（例: event種別）

## Tasks
- [ ] UIと状態管理を実装
- [ ] 検索性能を確認
- [ ] 回帰テストを追加

## Definition of Done
- 200件規模ログで操作可能
- 既存表示体験を壊さない
```

### 19-3
**Title**
`tts: 読み上げ設定プリセットを調整`

**Body**
```md
## Summary
読み上げ設定プリセットを見直し、初期体験の聞き取りやすさを改善する。

## Scope
- 速度/ピッチ/音量プリセットの調整
- 主要ブラウザでの挙動確認

## Tasks
- [ ] プリセット案を作成
- [ ] 実機確認を実施
- [ ] 既定値を更新

## Definition of Done
- 初期設定で過度な聞き取りづらさがない
- 設定変更UIとの整合が取れている
```

## Sprint 20（2026-05-07 〜 2026-05-20）

### 20-1
**Title**
`ci: ドキュメントと実装の乖離チェックを追加`

**Body**
```md
## Summary
主要ドキュメントと実装の乖離をPR段階で検知するチェックを追加する。

## Scope
- チェック対象ドキュメント定義
- CIジョブでの自動検証

## Tasks
- [ ] 乖離ルールを定義
- [ ] CIジョブを追加
- [ ] 失敗時メッセージを整備

## Definition of Done
- 主要乖離をPRで検知できる
- 誤検知率が許容範囲
```

### 20-2
**Title**
`docs: ROADMAP/LLM_ADAPTER更新フローを固定`

**Body**
```md
## Summary
ROADMAP/LLM_ADAPTER更新の運用フローを明文化して更新漏れを減らす。

## Scope
- 更新タイミング・責任者の定義
- PRテンプレへの反映

## Tasks
- [ ] 更新フローを文書化
- [ ] PRテンプレを更新
- [ ] レビュー観点を追加

## Definition of Done
- 運用手順がチームで共有される
- 主要ドキュメントの鮮度が改善する
```

### 20-3
**Title**
`ai: セッション記録・教育レポートのチェックリストを整備`

**Body**
```md
## Summary
AI運用での引き継ぎ漏れを防ぐため、セッション記録と教育レポートのチェックリストを整備する。

## Scope
- セッション終了時チェック項目
- レポート作成時チェック項目

## Tasks
- [ ] チェックリスト雛形を作成
- [ ] 運用手順へ組み込み
- [ ] サンプルを追加

## Definition of Done
- 引き継ぎ情報の欠落が減る
- レポート品質が一定化する
```

## Sprint 21（2026-05-21 〜 2026-06-03）

### 21-1
**Title**
`release: v0.2.0 RCチェックリストを作成/運用`

**Body**
```md
## Summary
v0.2.0 RC判定のためのチェックリストを作成し、実運用で確認する。

## Scope
- RC判定項目の定義
- 判定結果の記録方式を整備

## Tasks
- [ ] チェックリスト作成
- [ ] 試行運用を実施
- [ ] 不足項目を反映

## Definition of Done
- Go/No-Go判断基準が明確
- 判定ログを追跡できる
```

### 21-2
**Title**
`qa: cross-platform smoke matrix を確立`

**Body**
```md
## Summary
主要プラットフォーム向けのスモークテスト行列を定義し、継続運用可能にする。

## Scope
- 対象OS/配布物/観点の定義
- 実行頻度と担当の定義

## Tasks
- [ ] matrixを作成
- [ ] 実行手順を整理
- [ ] 記録フォーマットを統一

## Definition of Done
- プラットフォーム別の最低品質基準が明確
- 継続実施できる運用が整う
```

### 21-3
**Title**
`docs: getting-started と配布導線の最終更新`

**Body**
```md
## Summary
v0.2.0リリース準備として、getting-startedと配布導線を最終更新する。

## Scope
- 導入手順の最新化
- 配布ページ/リンクの整備

## Tasks
- [ ] getting-started更新
- [ ] 配布導線を更新
- [ ] 日英整合を確認

## Definition of Done
- 新規ユーザーが迷わず導入できる
- ドキュメント間リンク切れがない
```
