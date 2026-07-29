<a href="ROADMAP.ja.md"><kbd>日本語</kbd></a>
<a href="ROADMAP.en.md"><kbd>English</kbd></a>

# CLI Commentator ロードマップ（v1）

## これは何？
CLI Commentator は、非エンジニアで英語に不慣れな人が、CLI上で動くAIの作業を理解できる日本語のテキストと音声で監督するためのアプリです。

このページは **Goal（完成形）** と **そこに行く道（フェーズ）** と **現在地（いま何をやっているか）** を、非エンジニア向けに整理したものです。

---

## Goal（完成形）
- Claude Codeを起動し、その動作や指示をリアルタイムに日本語で解説・読み上げる
- 英語のCLI出力を読み続けなくても、**「いま何をしているか」「HUMANの判断が必要か」**を把握できる
- 許可待ち、質問、エラー、完了、長考・沈黙を検知し、介入すべき瞬間を逃さない
- 解説はClaude Code自身ではなく、ルールと軽量APIで生成する
- 口調プリセット（標準/関西弁など）＋「初心者向け1行説明」＋「用語注釈（括弧）」
- **秘密っぽい文字列をマスク**して漏えい事故を防ぐ
- 最終的にはClaude CodeとCodex CLIを並列で動かし、相互のやり取りを含めて監督する

---

## いまの方針（大事）
このプロジェクトは **「監督に必要な情報が過不足なく届くこと」**を最優先します。

実況の面白さは利用のフックとして活かしますが、口調が変わっても割り込み優先度とエラーの即時通知は共通にします。

## 長期改良の優先順位

1. **監督イベント検知**：許可待ち、質問、エラー、完了、長考・沈黙を検知し、重要度に応じて通知する
2. **日本語解説の質**：英語出力を平易な日本語で意図単位に要約し、必要な用語注釈を付ける
3. **起動フリクション排除**：説明書なしでClaude Codeの実況開始まで辿り着ける導線を作る
4. **並列AI監督**：Claude CodeとCodex CLIの複数セッションを監督する
5. **配布・共有**：外部配布と実況を共有しやすい導線を整える

監督と実況の面白さは同じイベント検知結果を使い、真面目トーン／実況トーンの提示層だけを分離します。

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

## 現在地（2026-07-12 時点）
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
- PR #213：起動失敗分類を server / desktop / web / distribution smoke / runbook で整合
- PR #217：recovery guidance の既知カテゴリ test coverage を拡張
- PR #218：Codex progress commentary noise を抑止
- PR #219：入力重複抑止・TTS遅延短縮・explanation prompt 改善
- PR #220：Sprint 16 起動復旧整合の証跡を release evidence log へ反映
- `#214` / `#215` は closed。Sprint 16 の remaining / blocked 再整理と、recovery guidance 残件の fallback 監視扱いへの整理が完了
- PR #237：server / web の `@types/node` を更新し、個別PR #238 / #239 を内包して整理
- PR #241-242：desktop release CI actions（`tauri-apps/tauri-action` v0.6.2 / `pnpm/action-setup` v5）を更新し、運用手順変更なしの docs note を追加
- PR #244：`tauri-plugin-updater` を 2.10.1 へ更新し、updater plugin maintenance として記録
- PR #249：Tauri runtime stack を 2.11 系へ更新し、runtime maintenance として記録。#248 は内包済みとして close
- 2026-05-08 時点で open PR は 0 件。依存更新PR群の整理は完了
- PR #259：Desktop sidecar prepare を冪等化し、`dev:desktop:managed` 起動前に同梱sidecarを安全に確認・再生成できるようにした

**Now**
- Issue #300 で長期改良方針を正本化。**Phase A-1（#304、監督イベント5分類）は 2026-07-19 に完了**
  - #305 fixture採取 → PR #310、#306 Claude TUI監督イベント4分類 → PR #311
  - #307 長考・沈黙検知 → PR #316、#308 優先度付きイベントパイプライン → PR #317
  - #309 優先度付きTTS（urgent割り込み / noticeキュー / progress従来）＋ Web UI 要対応表示 → PR #321。HUMAN実機受け入れ済み。スキンは現行の standard / cli の2種で確認（brutalism / paper は廃止済み）
- エラー膠着の反復検知を追加。同一エラーを2分以内に3回検出すると、urgentの「同じエラーが繰り返されている」イベントへ昇格する
- Apple Developer ID 証明書は当面発行しない方針のため、`#138` は Deferred / 保留扱いにする。signed/notarized release readiness は重要項目として残すが、証明書発行と外部配布準備を再開する段階で再着手する
- local desktop app polish / local readiness は、監督イベントの実機確認へ入るための起動導線として維持する
- ローカル検証の入口を `pnpm check:local-readiness` として追加。sidecar準備 → web lint/build → server test/typecheck → desktop cargo test を順に実行し、PASS/FAIL/SKIPで一覧表示する

**Next**
- 日本語解説・要約と、真面目トーン／実況トーンを分けた提示層を改善する（Phase B）。着手前にHUMAN/Ginoと優先順位を確認する
  - Phase Bの盲検評価では回答者向けexportにも実際の発話文をそのまま使う。ルール版TTSがフェーズを明示する長所により設問が容易になる点は、評価結果の解釈時に明記する

**Later**
- 説明書なしで実況開始まで辿り着ける起動導線を完成させる（Phase C）
- 複数セッション前提でClaude CodeとCodex CLIの並列監督へ拡張する
- dependency / desktop runtime maintenance は docs drift guard 経由で継続運用する
- 新しい具体的な失敗例が出たら、failure regression summary と recovery evidence を継続強化する
- Apple Developer ID 証明書の発行・配布準備を再開する段階で `#138` に戻り、signed/notarized `release-desktop` smoke と証跡記録を実施する

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

**現状整理（2026-05-08）**
- Done
  - server / desktop / web / smoke / runbook の起動失敗分類整合を main へ反映
  - distribution smoke に negative path を追加し、GitHub CI 上で `desktop_distribution_smoke` を継続運用
  - recovery guidance の既知カテゴリ coverage、commentary noise suppression、入力/TTS UX 改善を main へ反映
  - `#214` は closed。Sprint 16 の done / remaining / blocked 整理を記録
  - `#215` は closed。`要確認` は未知 / 非構造化エラー用 fallback として維持、`spawn` 細分類は具体例が出るまで保留と整理
- Remaining
  - 具体的な recovery 例が新しく出た場合は、通常の evidence log で継続収集する
- Blocked / Deferred
  - signed/notarized release readiness は `#138` 依存。具体的には Apple Developer ID certificate / GitHub Secrets / notarization validation が残件
  - clean internal 実機証跡は CI 証跡とは別管理

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
