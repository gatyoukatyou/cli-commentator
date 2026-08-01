import type { Event } from "../types.js";
import { NONE, type NarrationSubject } from "../commentary/narration-subject.js";

/**
 * Plain-Japanese sentence naming the subject. Shared with the speech contract,
 * which is style-neutral, so the wording lives here rather than being duplicated.
 */
export function standardSubjectLine(subject: NarrationSubject): string | null {
  switch (subject.kind) {
    case "file":
      return `${subject.name} を確認しています。`;
    case "searchTerm":
      return `「${subject.term}」を探しています。`;
    case "fileList":
      return "ファイル一覧を調べています。";
    case "check":
      return `${subject.label}を実行しています。`;
    case "action":
      return `${subject.phrase}しています。`;
    case "testResult":
      if (subject.failed) return `テストが${subject.failed}件失敗しました。`;
      if (subject.passed) return `テストが${subject.passed}件通りました。`;
      return null;
    default:
      return null;
  }
}

export function commentStandard(ev: Event, subject: NarrationSubject = NONE): string {
  if (ev.type === "write" && subject.kind === "file") {
    return `${subject.name} を書き換えています。`;
  }

  const specific = standardSubjectLine(subject);
  if (specific) return specific;

  return ev.type === "read" ? "ファイルを読んで状況を確認しています。" :
    ev.type === "stdout" ? "" :
    ev.type === "write" ? "ファイルを書き換えて修正を反映しています。" :
    ev.type === "search" ? "原因になりそうな箇所を検索しています。" :
    ev.type === "stderr" ? "エラー出力が出ているので内容を確認しています。" :
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
