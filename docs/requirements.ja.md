<a href="requirements.ja.md"><kbd>日本語</kbd></a>
<a href="requirements.en.md"><kbd>English</kbd></a>

# 要件（Must / Should / Could）

このプロジェクトは「対象CLIをPTYで包んで起動し、別ウィンドウで実況（解説）を流す」MVPから始まり、現在は Tauri Desktop 運用導線も含む。

## Must（MVPで絶対）

- **PTYラッパー起動（macOS/Windows）**
  - 本アプリが対象CLIを“包んで起動”し、入出力を取得できる
- **入力モードとフォールバック**
  - 既定は `INPUT_MODE=pty`、`INPUT_MODE=file` で外部ログ監視に対応
  - PTY初期化失敗時は `ptyUnavailable` を通知し、`INPUT_FILE` が有効なら file 監視へフォールバックできる
- **実況の自動生成（ルールベースでOK）**
  - 生ログをそのまま投げず、まず **イベント化**（read/search/test/error/git/github など）
  - **更新頻度：イベント発生時 + 最大2秒に1回（連打抑制）**
- **別ウィンドウUI**
  - 実況が別画面で流れる（CLI操作の邪魔をしない）
- **口調プリセット**
  - 最低2種類（例：標準／関西弁）+ 初心者向け1行解説 + 用語注釈（括弧）
- **漏えい対策（最低限）**
  - 送信前・表示前に「秘匿っぽい文字列」をマスク（APIキー/Bearer/長いトークン等）
- **ローカル動作（API無しで成立）**
  - 実況は当面ルール生成で成立（後でLLM差し替え）

## Should（次に入れる：価値を一段上げる）

- **LLM差し替え可能なAdapter設計**（OpenAI/Claude/Gemini等）
- **CLIプロファイル**（cmd/args/cwd/env/口調など保存）
- **エラーハンドリング**（PTY終了・クラッシュ・再起動）
- **Windowsでの安定ビルド**（node-ptyが詰まる場合の方針）

## Could（将来：外部監視モード）

- **外部監視コネクタ**
  - tmux（pipe/capture）
  - ログファイル tail
  - PowerShell transcript 等
- **音声読み上げ（TTS）**
  - 実況テキストをキューで読み上げ
  - 発話のキュー投入・開始・終了・キャンセル・間引きをセッション単位で記録し、実音声評価ログをJSONで一括出力
  - urgent割り込み、notice追記、progress間引き、30秒以内の同文progress反復、発話時間、キュー滞留を評価ログから検証

## 非機能（MVP基準）

- セキュリティ：マスク処理は“誤爆しても良いが漏れに強い”寄せ（allowlist化はShould）
- プラットフォーム：ローカルWeb と Tauri Desktop の両運用を維持し、手順を常に同期する
