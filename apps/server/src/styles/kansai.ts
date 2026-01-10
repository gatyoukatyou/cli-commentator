import type { Event } from "../types.js";

export function commentKansai(ev: Event): string {
  return ev.type === "read" ? "ファイル読んで状況確認してるで。" :
    ev.type === "write" ? "ファイル書き換えて修正反映してるで。" :
    ev.type === "search" ? "原因っぽいとこ探してるで。" :
    ev.type === "test" ? "テスト/型チェック回して確認中や。" :
    ev.type === "git" ? "Gitで変更まとめてるで。" :
    ev.type === "github" ? "GitHubのIssue/PR触ってるで。" :
    ev.type === "install" ? "依存関係やスクリプト処理してるで。" :
    ev.type === "error" ? "エラーや。原因特定して直す流れやな。" :
    ev.type === "start" ? "開始や。実況いくで。" :
    ev.type === "done" ? "ひとまず区切りや。おつかれさん。" :
    "ログ進んでるで。";
}
