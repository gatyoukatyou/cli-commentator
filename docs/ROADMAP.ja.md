<a href="ROADMAP.ja.md"><kbd>日本語</kbd></a>
<a href="ROADMAP.en.md"><kbd>English</kbd></a>

# CLI Commentator ロードマップ（v1）

## これは何？
CLI Commentator は「ターミナルの作業ログを見て、別ウィンドウで初心者向け実況（解説）を流す」アプリです。  
このページは **Goal（完成形）** と **そこに行く道（フェーズ）** と **現在地（いま何をやっているか）** を、非エンジニア向けに整理したものです。

---

## Goal（完成形）
- ふだん通りにターミナルで作業（Claude Code / Codex / bash / git など）
- アプリがログを読み取り、**「いま何してる？」を自動実況**
- 実況は **別ウィンドウ**に流れ、作業の邪魔をしない
- 口調プリセット（標準/関西弁など）＋「初心者向け1行説明」＋「用語注釈（括弧）」
- **秘密っぽい文字列をマスク**して漏えい事故を防ぐ
- 最初は **ルールベースで成立**（後でLLM差し替え可能）

---

## いまの方針（大事）
このプロジェクトは、派手な機能よりも **「壊れない土台」**を優先します。  
まずは “確実に動く最小構成（MVP）” を作り、価値が見えたら拡張します。

---

## フェーズ（全体像）

### Phase 0：見える化・運用の土台
- README / docs の運用ルールを先に固定（迷子防止）
- 日英ペアのドキュメント方針を整備

**Done**
- README を日英分離し、ランディング用 README.md を作成
- docs/ に日英 README を追加（運用ポリシー）

---

### Phase 1：心臓部の安定化（detect）
ログの種類を自動判定する「detect」がブレると実況が崩壊するため、先に堅牢化します。

**Done**
- PR #1：detect の境界テスト強化（混在ログはgeneric、50行制限を固定、重要定数をexport）

---

### Phase 2：MVPを"体験できる形"に繋ぐ（最小価値の提示）
- PTYでCLIを包んで起動（またはログ取り込み）
- ログをイベント化 → 実況生成 → 別ウィンドウに表示
- 2秒間隔の連打抑制、最低限のマスク、口調プリセット

**Done**
- 要件表（Must/Should/Could）を docs/requirements.* で固定
- apps/server + apps/web のMVP実装完了（実況が流れる状態）
- detectロック境界fixtureを追加
- GitHub Actions CI最小導入

---

### Phase 3：使い続けたくなる（Should領域）

**Done**
- 運用堅牢性（Operational Resilience）
  - サーバー終了時のクリーンアップ（ターミナル保護）
  - Web側WebSocket再接続
- LLM Adapter設計（Sprint 5-9）
  - OpenAI / Groq / Local / Gemini / Anthropic プロバイダー対応
  - タイムアウト保護・AbortController対応
  - スモークテスト・コントラクトテスト
- CLIプロファイル保存（Sprint 11）
  - プロファイルのCRUD操作
  - WebSocket経由でのプロファイル管理
  - プロファイル切替でPTY即時再起動（Sprint 13）
- Windowsビルド安定化（node-pty不可時の契約固定 + 自動フォールバック）

---

### Phase 4：配布・常用（Tauri化など）[進行中]
- デスクトップ化（常駐/自動起動/アップデート）
- OS統合・署名・配布導線
- 音声読み上げ（TTS）
- 外部監視モード（tmux / ログファイル tail）

**進行中**
- Tauri managed の起動ライフサイクル（start/stop/status/recovery）は運用中
- Sprint 28（親子Issue #141-#146）を完了し、docs同期 + sidecar同梱起動 + ポート自動退避 + CI最小ガードまで反映
- 配布信頼性の仕上げとして、署名前提チェックと起動失敗時の復旧品質を継続改善

---

## 現在地（2026-02-18 時点）
**Done**
- PR #1：detect 境界テスト（混在→generic、50行制限、重要定数export）
- PR #2：ロードマップ docs 追加（日英＋docs/READMEからリンク）
- PR #4：detectロック境界fixture + CI導入
- MVP実装完了（apps/server + apps/web が動作する状態）
- PR #6：Sprint 4 運用堅牢性
- PR #7-9：LLM Adapter基盤（factory + mock + comment統合）
- Sprint 10：LLM Providers（OpenAI / Groq / Local / Gemini）
- PR #19：Anthropic provider
- PR #20-21：LLM スモークテスト + コントラクトテスト
- PR #22：CLIプロファイル管理
- Sprint 13：プロファイル切替でPTY再起動
- PR #94：PTY unavailable UX + WS契約整備 + ConPTY判定テスト + web lint CI
- PR #95-96：node-pty失敗時の `ptyUnavailable` 契約固定（再起動経路/統合寄りテスト）
- PR #97：Tauri managed起動の状態機械化（start/stop冪等、failed可視化）
- PR #98：Tauri状態機械の契約テスト + desktop CI（cargo check/test）
- PR #99：Desktop Server運用UI（状態表示/復旧ガイド） + Auto-startトグル
- PR #100：Desktop配布基盤（Auto-start制御 + 配布チェックリストdocs）
- PR #101：Updater確認コマンド + Desktopパネル表示/操作
- PR #102：Updater設定の土台 + タグ起点desktopリリースワークフロー
- 3AI運用基盤（`AGENTS.md` / `GEMINI.md` / `/wrapup` 運用フック）を追加
- 2026-02-13: `v0.0.0-smoke.5` で `release-desktop` をドライランし、Updater鍵ペア検証成功を確認（Apple Secrets不足を検出）
- 2026-02-14: Sprint 28 の管理Issueを作成（親 #141、子 #142-#146）
- PR #147：Sprint 28 docs同期（Desktop運用 / 入力モード `pty|file` / Windows制約 / `.env.example`）
- PR #148-151：同梱server成果物生成 + 同梱起動切替 + ポート自動退避 + desktop配布スモークCI
- PR #153-155：getting-started/配布導線更新 + ROADMAP/LLM_ADAPTER更新フロー固定 + docs差分CIガード
- PR #156-158：AI運用チェックリスト / v0.2.0 RCチェックリスト / cross-platform smoke matrix docs
- PR #159-164：実況品質とUX改善（テンプレ改善、fixture拡充、detect誤判定低減、ログ検索、TTS調整、用語注釈）
- PR #165：同梱配布経路のruntime smokeをCIへ追加
- PR #166：Apple署名Secretsのpreflight validationを追加
- PR #167：Desktop失敗分類と復旧ガイド表示を改善
- PR #174：server起動失敗分類ログを構造化（分類コード + fallback結果 + 回帰テスト）
- PR #175：server状態遷移ログを構造化（`[server/state-event]` + 統合テスト検証）
- PR #178：v0.2.0 RC判定証跡テンプレートを追加（RC checklist / runbook / docs indexの導線を統一）

**Now**
- 2026-02-18 のローカル事前検証を実施（`verify:updater` / web lint+build / `CLI_COMMENTATOR_FORCE_NO_PTY=1` server test / failure regression 34/34 / desktop distribution smoke がPass）
- `CLI_COMMENTATOR_FORCE_NO_PTY=1` 実行時に node-pty 必須ケースを skip するテスト前提を補強し、Runbook のローカル検証コマンドを再現可能化
- `release-desktop` の smoke 実行を再開し、`smoke.01` / `smoke.02` の失敗要因（sidecar node不足、runner unsupported、release作成権限）を証跡へ反映
- `.github/workflows/release-desktop.yml` に sidecar 準備/検証ステップを追加し、x86 runner を `macos-15-intel` へ修正（`smoke.03` で arm64/x64 両bundle生成を確認）
- `docs/release-runbook.*` / `docs/release-evidence-log.*` を当日証跡で更新
- docs drift guard と smoke matrix を運用し、v0.2.0 RC 判断材料を継続蓄積
- `#138`（Apple certificate/secrets）未解消のため signed 配布判定は保留

**Next**
- `#138` を解消し、`pnpm verify:apple-signing` をPassさせる
- `Resource not accessible by integration` の権限制約を解消し、Draft Release作成を復旧する
- 起動障害系の回帰ケースを継続拡張（配布物起動/署名モード差分を含む）

---

## 2週間スプリント計画（Issue分解案）

### Sprint 14（2026-02-12 〜 2026-02-25）: Updater本番化
**Issue案**
- `release: updater公開鍵を実値へ更新し検証フローを追加`
- `ci: タグ起点で署名付きDraft Releaseを自動生成`
- `docs: リリースRunbook v1（復旧/ロールバック手順を含む）`

**完了条件**
- 実タグで更新確認まで再現できる
- 失敗時の復旧手順がドキュメント化されている

### Sprint 15（2026-02-26 〜 2026-03-11）: Notarization/署名の土台
**Issue案**
- `desktop: macOSコード署名をCIフローへ統合`
- `desktop: notarization submit/staple を自動化`
- `docs: 証明書・Secrets運用ガイドを整備`

**完了条件**
- 署名付き成果物を継続的に生成できる
- 証明書更新時の運用手順が確立されている

### Sprint 16（2026-03-12 〜 2026-03-25）: 配布信頼性と起動復旧
**Issue案**
- `qa: クリーン環境向け配布物スモークテストを追加`
- `desktop: 起動失敗時の復旧ガイドUIを改善`
- `server: 起動失敗の原因分類ログを強化`

**完了条件**
- クリーン環境で「インストール→起動→実況開始」が通る
- 主要な起動失敗パターンの一次切り分けが可能

### Sprint 17（2026-03-26 〜 2026-04-08）: 可観測性とフォールバック強化
**Issue案**
- `server: 状態遷移ログを構造化して収集可能にする`
- `test: node-pty unavailable のフォールバックE2Eを拡充`
- `ci: 障害シナリオの回帰テストジョブを追加`

**完了条件**
- 障害時に時系列で原因追跡できる
- フォールバック挙動が回帰で壊れにくい状態になる

### Sprint 18（2026-04-09 〜 2026-04-22）: 実況品質改善 1
**Issue案**
- `rulesets: detect誤判定ケースを追加し閾値を調整`
- `styles: 初心者向け1行説明テンプレートを改善`
- `test: 実況品質fixtureとsnapshotを拡充`

**完了条件**
- 代表シナリオで誤判定率が現状より低下
- 実況文の可読性評価が改善

### Sprint 19（2026-04-23 〜 2026-05-06）: 実況品質改善 2 / UX
**Issue案**
- `web: 用語注釈の見せ方を改善（読みやすさ優先）`
- `web: 実況ログの最低限フィルタ/検索を追加`
- `tts: 読み上げ設定プリセットを調整`

**完了条件**
- 初心者が実況を追いやすいUIになっている
- 長時間利用時の閲覧性が改善

### Sprint 20（2026-05-07 〜 2026-05-20）: 運用自動化
**Issue案**
- `ci: ドキュメントと実装の乖離チェックを追加`
- `docs: ROADMAP/LLM_ADAPTER更新フローを固定`
- `ai: セッション記録・教育レポートのチェックリストを整備`

**完了条件**
- 主要ドキュメントの鮮度低下をPR段階で検知できる
- AI運用の引き継ぎ漏れが減る

### Sprint 21（2026-05-21 〜 2026-06-03）: v0.2.0 リリース準備
**Issue案**
- `release: v0.2.0 RCチェックリストを作成/運用`
- `qa: cross-platform smoke matrix を確立`
- `docs: getting-started と配布導線の最終更新`

**完了条件**
- v0.2.0 のRC判断材料が揃う
- 配布〜初回起動のユーザー導線が明確

---

## 更新ルール（簡易）
- 「Done / Now / Next」だけは毎スプリント更新
- 大きな方針転換（例：Tauri化前倒し）が起きたら、Phase見直しも同時に更新
