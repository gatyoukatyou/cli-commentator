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

### Phase 4：配布・常用（Tauri化など）
- デスクトップ化（常駐/自動起動/アップデート）
- OS統合・署名・配布導線
- 音声読み上げ（TTS）
- 外部監視モード（tmux / ログファイル tail）

---

## 現在地（2026-02-07 時点）
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

**Now**
- Phase 4 実行中（Updater本番設定の土台 + タグ起点リリース自動化）

**Next**
- Updater公開鍵プレースホルダーの実値化と署名付きDraft Releaseの実運用
- Notarization/コード署名と配布対象プラットフォーム拡張

---

## 更新ルール（簡易）
- 「Done / Now / Next」だけは毎スプリント更新
- 大きな方針転換（例：Tauri化前倒し）が起きたら、Phase見直しも同時に更新
