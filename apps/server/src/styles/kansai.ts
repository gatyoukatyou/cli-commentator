import type { Event } from "../types.js";
import { NONE, type NarrationSubject } from "../commentary/narration-subject.js";

function subjectLine(subject: NarrationSubject): string | null {
  switch (subject.kind) {
    case "file":
      return `${subject.name} を見てるで。`;
    case "searchTerm":
      return `「${subject.term}」を探してるで。`;
    case "fileList":
      return "ファイル一覧を調べてるで。";
    case "check":
      return `${subject.label}を回してるで。`;
    case "action":
      return `${subject.phrase}してるで。`;
    case "testResult":
      if (subject.failed) return `テストが${subject.failed}件こけたで。`;
      if (subject.passed) return `テストが${subject.passed}件通ったで。`;
      return null;
    default:
      return null;
  }
}

export function commentKansai(ev: Event, subject: NarrationSubject = NONE): string {
  if (ev.type === "write" && subject.kind === "file") {
    return `${subject.name} を書き換えてるで。`;
  }

  const specific = subjectLine(subject);
  if (specific) return specific;

  return ev.type === "read" ? "ファイル読んで状況確認してるで。" :
    ev.type === "stdout" ? "" :
    ev.type === "write" ? "ファイル書き換えて修正反映してるで。" :
    ev.type === "search" ? "原因っぽいとこ探してるで。" :
    ev.type === "stderr" ? "エラー出力が出てるから内容確認してるで。" :
    ev.type === "test" ? "テスト/型チェック回して確認中や。" :
    ev.type === "build" ? "ビルド走らせてるで。" :
    ev.type === "lint" ? "コードチェック/整形してるで。" :
    ev.type === "server" ? "開発サーバー立ち上げてるで。" :
    ev.type === "git" ? "Gitで変更まとめてるで。" :
    ev.type === "github" ? "GitHubのIssue/PR触ってるで。" :
    ev.type === "install" ? "依存関係やスクリプト処理してるで。" :
    ev.type === "error" ? "エラーや。原因特定して直す流れやな。" :
    ev.type === "start" ? "開始や。実況いくで。" :
    ev.type === "done" ? "ひとまず区切りや。おつかれさん。" :
    "ログ進んでるで。";
}
