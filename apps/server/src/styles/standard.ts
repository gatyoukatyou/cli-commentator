import type { Event } from "../types.js";

export function commentStandard(ev: Event): string {
  return ev.type === "read" ? "ファイルを読んで状況を確認しています。" :
    ev.type === "write" ? "ファイルを書き換えて修正を反映しています。" :
    ev.type === "search" ? "原因になりそうな箇所を検索しています。" :
    ev.type === "test" ? "テスト/型チェックで壊れていないか確認しています。" :
    ev.type === "build" ? "ビルド処理を実行しています。" :
    ev.type === "lint" ? "コードの品質チェック/整形を行っています。" :
    ev.type === "server" ? "開発サーバーを起動・確認しています。" :
    ev.type === "git" ? "Gitで変更履歴を整理しています。" :
    ev.type === "github" ? "GitHub上のIssue/PRを操作しています。" :
    ev.type === "install" ? "依存関係の追加やスクリプト実行をしています。" :
    ev.type === "error" ? "エラーが出ています。原因特定→修正の流れになりそうです。" :
    ev.type === "start" ? "開始しました。これから作業の流れを実況します。" :
    ev.type === "done" ? "いったん区切りです。おつかれさまでした。" :
    "ログが進んでいます。";
}
