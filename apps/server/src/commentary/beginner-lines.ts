import { classifyFailure, type FailureKind } from "@cli-commentator/shared";
import type { Event, EventType } from "../types.js";
import { describeBashMeaning, detailCommand, extractReadTarget, extractSearchTerm, extractWriteTarget } from "./bash-meaning.js";
import { describeNarrationSubject } from "./narration-subject.js";

/**
 * The beginner explanation is the supervision layer: it stays in plain Japanese
 * regardless of the narration style the user picked (see `commentByRules`), so
 * rules carry a single sentence rather than one per style.
 *
 * Rules are evaluated in order and the first match wins, so put the specific
 * pattern above the general one. Returning `""` suppresses the explanation;
 * returning `null` falls through to the next rule.
 */
type ExplanationContext = {
  ev: Event;
  /** Trimmed `ev.detail`. */
  detail: string;
  /** The command inside `Bash(...)`, or the detail itself. */
  command: string;
};

type ExplanationRule = {
  id: string;
  /** Restricts the rule to these event types; unrestricted when omitted. */
  types?: ReadonlyArray<EventType>;
  when: (ctx: ExplanationContext) => boolean;
  line: (ctx: ExplanationContext) => string | null;
};

function onCommand(re: RegExp) {
  return (ctx: ExplanationContext) => re.test(ctx.command);
}

function onDetail(re: RegExp) {
  return (ctx: ExplanationContext) => re.test(ctx.detail);
}

/** A rule whose sentence does not depend on the matched text. */
function fixed(text: string) {
  return () => text;
}

/** Display wording per failure kind; the classification itself is shared. */
const FAILURE_EXPLANATIONS: Record<FailureKind, string> = {
  "type-error": "TypeScript が『データや部品のつながりが合っていない』箇所を知らせています。",
  "port-in-use":
    "使おうとしたポートが既に別のプロセスに使われています。先に動いているものを止めるか、別のポートを使う場面です。",
  permission: "権限が足りず操作が拒否されました。書き込み先や実行権限を確認する場面です。",
  "module-not-found": "参照している部品が見つかりません。依存の導入漏れか、参照先の誤りが疑われます。",
  "command-not-found": "必要なコマンドが見つかりません。導入漏れか、パスの設定を確認する場面です。",
  "exit-code": "実行したコマンドが失敗して終了しました。原因は直前の出力に出ていることが多いです。",
};

const RULES: ReadonlyArray<ExplanationRule> = [
  // --- stdout: classify what the raw output actually is -------------------
  {
    id: "stdout.shell-prompt",
    types: ["stdout"],
    when: onDetail(/^(?:bash|zsh|sh)(?:-[\d.]+)?[$%#]\s*$/iu),
    line: fixed(""),
  },
  {
    id: "stdout.file-read",
    types: ["stdout"],
    when: onCommand(/^(?:cat|head|tail)\b|^sed\s+(?:-[^\s]+\s+)*/iu),
    line: fixed("指定したファイルの内容を読み、現在の実装を確認しています。"),
  },
  {
    id: "stdout.file-list",
    types: ["stdout"],
    when: onCommand(/^(?:ls\b|find\b|fd\b|rg\s+--files\b)/iu),
    line: fixed("ファイルやフォルダの一覧を見て、確認対象を絞っています。"),
  },
  {
    id: "stdout.source-code",
    types: ["stdout"],
    when: onDetail(/^(?:export\s+)?(?:const|let|var|function|class|interface|type|import)\b/iu),
    line: fixed("ソースコードの一部を表示し、実装内容を確認しています。"),
  },
  {
    id: "stdout.test-result",
    types: ["stdout"],
    when: onDetail(/(?:Test Files|Tests?|passed|failed|PASS|FAIL)/u),
    line: fixed("テスト結果を見て、変更後も正常に動くか確認しています。"),
  },
  {
    id: "stdout.paths",
    types: ["stdout"],
    when: onDetail(/(?:^|\s)(?:[\w@+.-]+\/)+[\w@+.-]+(?:\s|$)/iu),
    line: fixed("ファイルやフォルダの一覧を見て、確認対象を絞っています。"),
  },

  // --- file access -------------------------------------------------------
  {
    id: "read.target",
    when: onDetail(/^[⏺•]\s*Read\(/u),
    line: ({ detail }) => {
      const target = extractReadTarget(detail);
      // Without a real file name the sentence reads as "対象ファイル を読んで…";
      // the type-level line says the same thing in natural Japanese.
      if (!target) return null;
      const isDoc = /\.(md|txt|rst|adoc)$/i.test(target) || /readme|docs?/i.test(target);
      return `${target} を読んで、${isDoc ? "手順や前提" : "現在の実装"}を確認しています。`;
    },
  },
  {
    id: "write.target",
    when: onDetail(/^[⏺•]\s*(?:Update|Write)\(/u),
    line: ({ detail }) => {
      const target = extractWriteTarget(detail);
      if (!target) return null;
      return `${target} を書き換えて、挙動を直接調整しています。`;
    },
  },
  {
    id: "write.apply-patch",
    when: onDetail(/\bapply_patch\b|apply patch/iu),
    line: fixed("変更差分をまとめて当てて、複数箇所を一気に更新しています。"),
  },

  // --- search ------------------------------------------------------------
  {
    id: "search.pattern",
    types: ["search"],
    when: onCommand(/\b(?:rg|grep)\b/iu),
    line: ({ command }) => {
      const term = extractSearchTerm(command);
      return `${term ? `「${term}」を手がかりに` : ""}プロジェクト全体を横断検索して、関係する場所を絞っています。`;
    },
  },

  // --- GitHub ------------------------------------------------------------
  {
    id: "github.pr-checks",
    types: ["github"],
    when: onCommand(/\bgh\s+pr\s+checks\b/iu),
    line: fixed("PRの自動チェック結果を見て、公開前の安全確認をしています。"),
  },
  {
    id: "github.pr-create",
    types: ["github"],
    when: onCommand(/\bgh\s+pr\s+create\b/iu),
    line: fixed("変更をレビュー依頼の形にまとめています。ここから他の人の確認が入ります。"),
  },
  {
    id: "github.pr-merge",
    types: ["github"],
    when: onCommand(/\bgh\s+pr\s+merge\b/iu),
    line: fixed("確認の済んだ変更を本流へ取り込んでいます。取り込み後は元に戻しにくくなります。"),
  },
  {
    id: "github.pr-inspect",
    types: ["github"],
    when: onCommand(/\bgh\s+pr\s+(?:view|list|diff|status)\b/iu),
    line: fixed("PRの内容や状態を見て、取り込んでよいかを確かめています。"),
  },
  {
    id: "github.issue",
    types: ["github"],
    when: onCommand(/\bgh\s+issue\b/iu),
    line: fixed("課題の内容や一覧を確認して、次に扱うものを選んでいます。"),
  },
  {
    id: "github.run",
    types: ["github"],
    when: onCommand(/\bgh\s+(?:run|workflow)\b/iu),
    line: fixed("GitHub側で動く自動処理の実行状況を確認しています。"),
  },

  // --- Git ---------------------------------------------------------------
  {
    id: "git.status",
    types: ["git", "github"],
    when: onCommand(/\bgit\s+status\b/iu),
    line: fixed("変更されたファイル一覧を見て、今どこまで触ったか確認しています。"),
  },
  {
    id: "git.commit",
    types: ["git", "github"],
    when: onCommand(/\bgit\s+commit\b/iu),
    line: fixed("変更をひとつの区切りとして記録しています。ここまでの状態に戻せるようになります。"),
  },
  {
    id: "git.push",
    types: ["git", "github"],
    when: onCommand(/\bgit\s+push\b/iu),
    line: fixed("手元の記録をGitHub側へ送っています。ここから先は他の人からも見える状態になります。"),
  },
  {
    id: "git.diff",
    types: ["git", "github"],
    when: onCommand(/\bgit\s+diff\b/iu),
    line: fixed("変更前と変更後を並べて、意図した箇所だけが変わっているか確かめています。"),
  },
  {
    id: "git.log",
    types: ["git", "github"],
    when: onCommand(/\bgit\s+(?:log|show|blame)\b/iu),
    line: fixed("これまでの変更履歴をたどって、いつ何が変わったかを確認しています。"),
  },
  {
    id: "git.add",
    types: ["git", "github"],
    when: onCommand(/\bgit\s+(?:add|restore)\b/iu),
    line: fixed("次の記録に含める変更を選んでいます。"),
  },
  {
    id: "git.branch",
    types: ["git", "github"],
    when: onCommand(/\bgit\s+(?:switch|checkout|branch|fetch|clone)\b/iu),
    line: fixed("作業する枝を切り替えて、他の作業と混ざらないようにしています。"),
  },
  {
    id: "git.integrate",
    types: ["git", "github"],
    when: onCommand(/\bgit\s+(?:merge|rebase|pull|cherry-pick)\b/iu),
    line: fixed("別々に進んだ変更をひとつにまとめています。競合が出た場合は手作業の調整が必要です。"),
  },
  {
    id: "git.stash",
    types: ["git", "github"],
    when: onCommand(/\bgit\s+(?:stash|reset)\b/iu),
    line: fixed("作業中の変更を退避したり戻したりして、取り込み方をやり直しています。"),
  },

  // --- verification ------------------------------------------------------
  {
    id: "test.result-counts",
    types: ["test"],
    when: ({ ev }) => describeNarrationSubject(ev).kind === "testResult",
    line: ({ ev }) => {
      const subject = describeNarrationSubject(ev);
      if (subject.kind !== "testResult") return null;
      if (subject.failed) {
        return `テストが${subject.failed}件失敗しました。失敗した項目名が原因の手がかりになります。`;
      }
      if (subject.passed) {
        return `テストが${subject.passed}件すべて通りました。変更による副作用は見つかっていません。`;
      }
      return null;
    },
  },
  {
    id: "test.typecheck",
    types: ["test"],
    when: onCommand(/\b(?:tsc|typecheck)\b/iu),
    line: fixed("プログラム同士のつながりが噛み合っているか、型ルールで機械確認しています。"),
  },
  {
    id: "test.runner",
    types: ["test"],
    when: onCommand(/\b(?:test|vitest|jest|playwright)\b/iu),
    line: fixed("変更の副作用がないか、自動テストで機械的に確認しています。"),
  },
  {
    id: "build.any",
    types: ["build"],
    when: () => true,
    line: fixed("配布や実行ができる形にまとめています。ここが通れば実際に動かせる状態になります。"),
  },
  {
    id: "lint.any",
    types: ["lint"],
    when: () => true,
    line: fixed("書き方の統一と、よくある間違いを機械的に洗い出しています。動作そのものではなく品質の確認です。"),
  },
  {
    id: "server.listening",
    types: ["server"],
    when: onDetail(/\b(?:listening\s+on|ready\s+in|Local:\s*http|server\s+(?:started|running))\b/iu),
    line: fixed("サーバーが待ち受けを始めました。ブラウザなどから実際の動きを確認できる状態です。"),
  },
  {
    id: "server.any",
    types: ["server"],
    when: () => true,
    line: fixed("動作確認用のサーバーを立ち上げています。実際の画面や応答を確かめる準備です。"),
  },

  // --- dependencies ------------------------------------------------------
  {
    id: "install.install",
    types: ["install"],
    when: onCommand(/\b(?:pnpm|npm|yarn)\s+install\b/iu),
    line: fixed("必要な部品をそろえて、この環境で動く状態にしています。"),
  },
  {
    id: "install.add",
    types: ["install"],
    when: onCommand(/\b(?:pnpm|npm|yarn)\s+(?:add|i)\b/iu),
    line: fixed("新しい部品を追加して、使える機能を増やしています。"),
  },
  {
    id: "install.remove",
    types: ["install"],
    when: onCommand(/\b(?:pnpm|npm|yarn)\s+(?:remove|uninstall)\b/iu),
    line: fixed("使わなくなった部品を外して、構成を整理しています。"),
  },

  // --- failures: name the class of problem, then the next thing to check --
  // Detection is shared with the spoken urgent line so the two cannot drift;
  // only the wording differs, since display has room to explain and speech
  // has to fit one interrupting breath.
  {
    id: "error.classified",
    types: ["error", "stderr"],
    when: ({ detail }) => classifyFailure(detail) !== null,
    line: ({ detail }) => {
      const kind = classifyFailure(detail);
      return kind ? FAILURE_EXPLANATIONS[kind] : null;
    },
  },

  // --- generic tool call: last resort before the type-level table ---------
  {
    id: "stdout.bash",
    types: ["stdout"],
    when: onDetail(/^[⏺•]\s*Bash\(/u),
    line: ({ command }) => describeBashMeaning(command, "standard").memo,
  },
];

function contextualBeginnerLine(ev: Event): string | null {
  const detail = ev.detail?.trim();
  if (!detail) return null;
  const ctx: ExplanationContext = { ev, detail, command: detailCommand(detail) };

  for (const rule of RULES) {
    if (rule.types && !rule.types.includes(ev.type)) continue;
    if (!rule.when(ctx)) continue;
    const line = rule.line(ctx);
    if (line !== null) return line;
  }
  return null;
}

type BeginnerLineTable = Record<EventType | "default", string>;

const BEGINNER_LINES: BeginnerLineTable = {
  read: "現状を把握して次の修正方針を決めています。",
  stdout: "",
  stderr: "エラー出力を確認して原因を絞っています。",
  write: "問題を直すために内容を更新しています。",
  search: "手がかりを探して調査範囲を絞っています。",
  test: "変更で壊れていないか確認しています。",
  build: "実行・配布できる形にまとめています。",
  lint: "読みやすさと品質ルールを確認しています。",
  server: "動作確認のため実行環境を立ち上げています。",
  git: "変更履歴を整理して戻せる状態にしています。",
  github: "Issue/PRで作業状況を同期しています。",
  install: "必要なツールや依存を揃えています。",
  error: "失敗ログを手がかりに修正方針を決めます。",
  start: "これから作業の流れを順に追います。",
  done: "作業がひと区切りで、結果を確認しています。",
  default: "状況を見ながら次の手を選んでいます。",
};

export function beginnerOneLine(ev: Event): string {
  const contextual = contextualBeginnerLine(ev);
  if (contextual !== null) return contextual;
  return BEGINNER_LINES[ev.type] ?? BEGINNER_LINES.default;
}
