import type { Event } from "../types.js";

export function commentZundamon(ev: Event): string {
  return ev.type === "read" ? "ファイルを読んで状況確認してるのだ。" :
    ev.type === "write" ? "修正を反映して書き換えてるのだ。" :
    ev.type === "search" ? "原因になりそうな所を探してるのだ。" :
    ev.type === "test" ? "テスト/型チェックで確認してるのだ。" :
    ev.type === "build" ? "ビルドを実行してるのだ。" :
    ev.type === "lint" ? "コードチェック/整形してるのだ。" :
    ev.type === "server" ? "開発サーバーを立ち上げてるのだ。" :
    ev.type === "git" ? "Gitで変更を整理してるのだ。" :
    ev.type === "github" ? "GitHubのIssue/PRを操作してるのだ。" :
    ev.type === "install" ? "依存関係やスクリプトを処理してるのだ。" :
    ev.type === "error" ? "エラーなのだ…原因を見つけて直すのだ。" :
    ev.type === "start" ? "開始なのだ！実況していくのだ。" :
    ev.type === "done" ? "いったん区切りなのだ。おつかれさまなのだ。" :
    "ログが進んでるのだ。";
}
