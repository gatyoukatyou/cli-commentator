import { extractSearchPattern, isFileListExecution, representativeGlossaryTerm } from "../command-analysis.js";
import type { Event } from "../types.js";
import { detailCommand, extractReadTarget, extractWriteTarget } from "./bash-meaning.js";

/**
 * The observed object of an event, extracted once and shared by every narration
 * style. Rule-based narration used to depend on `ev.type` alone, which capped
 * its vocabulary at one fixed sentence per type; carrying the subject lets each
 * style name what is actually being touched.
 */
export type NarrationSubject =
  | { kind: "none" }
  /** A single file being read or written. */
  | { kind: "file"; name: string }
  /** The pattern a search is looking for. */
  | { kind: "searchTerm"; term: string }
  /** A search that enumerates files rather than matching content. */
  | { kind: "fileList" }
  /** The kind of verification being run (type check / automated test). */
  | { kind: "check"; label: string }
  /** Counts reported by a finished test run. */
  | { kind: "testResult"; passed: number | null; failed: number | null }
  /**
   * A サ変 noun phrase for an operation in progress, rendered by each style as
   * `<phrase>しています。` / `<phrase>してるで。` / `<phrase>してるのだ。`. One kind
   * covers the whole git / GitHub / dependency / server vocabulary, so adding an
   * operation costs one phrase rather than one sentence per style.
   */
  | { kind: "action"; phrase: string };

export const NONE: NarrationSubject = { kind: "none" };

/**
 * Speech for `progress` events is capped at 30 characters by the speech
 * contract, and anything longer is replaced by a generic fallback. Subjects are
 * clipped here so a long path never costs the sentence its subject entirely.
 */
const MAX_FILE_NAME_LENGTH = 18;
const MAX_SEARCH_TERM_LENGTH = 20;

function clip(value: string, max: number): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}

function fileSubject(target: string | null): NarrationSubject {
  return target ? { kind: "file", name: clip(target, MAX_FILE_NAME_LENGTH) } : NONE;
}

/**
 * Search patterns are regexes, so they routinely carry alternations, quotes and
 * JSON fragments (`"name": "cli-commentator"`). Only a plain identifier-like
 * term reads aloud as a phrase, so this is an allowlist rather than a blocklist.
 */
const SAFE_TERM_RE = /^[\w.\-/ ]+$/u;

function testResult(detail: string): NarrationSubject | null {
  // vitest: "Tests  2 failed | 10 passed (12)"
  // jest:   "Tests: 1 failed, 12 passed, 13 total"
  const failed = detail.match(/(\d+)\s*(?:tests?\s+)?failed/iu);
  const passed = detail.match(/(\d+)\s*(?:tests?\s+)?passed/iu);
  if (!failed && !passed) return null;
  return {
    kind: "testResult",
    failed: failed ? Number(failed[1]) : null,
    passed: passed ? Number(passed[1]) : null,
  };
}

/**
 * Ordered command patterns to サ変 phrases; the first match wins, so the
 * specific subcommand must precede the general one.
 */
type ActionTable = ReadonlyArray<readonly [RegExp, string]>;

const GIT_ACTIONS: ActionTable = [
  [/\bgit\s+status\b/iu, "変更の一覧を確認"],
  [/\bgit\s+commit\b/iu, "変更を記録"],
  [/\bgit\s+push\b/iu, "GitHubへ送信"],
  [/\bgit\s+diff\b/iu, "変更前後を比較"],
  [/\bgit\s+(?:log|show|blame)\b/iu, "変更履歴を確認"],
  [/\bgit\s+(?:add|restore)\b/iu, "記録する変更を選択"],
  [/\bgit\s+(?:switch|checkout|branch|fetch|clone)\b/iu, "作業ブランチを変更"],
  [/\bgit\s+(?:merge|rebase|pull|cherry-pick)\b/iu, "変更をひとつに統合"],
  [/\bgit\s+(?:stash|reset)\b/iu, "変更を退避"],
];

const GITHUB_ACTIONS: ActionTable = [
  [/\bgh\s+pr\s+checks\b/iu, "PRの自動チェックを確認"],
  [/\bgh\s+pr\s+create\b/iu, "レビュー依頼を作成"],
  [/\bgh\s+pr\s+merge\b/iu, "PRを取り込み"],
  [/\bgh\s+pr\b/iu, "PRの状態を確認"],
  [/\bgh\s+issue\b/iu, "課題を確認"],
  [/\bgh\s+(?:run|workflow)\b/iu, "CIの状況を確認"],
];

const SERVER_STARTED_RE = /\b(?:listening\s+on|ready\s+in|Local:\s*http|server\s+(?:started|running))\b/iu;
const MAX_PACKAGE_NAME_LENGTH = 16;

// `(?:-\S+\s+)*` skips flags, so `pnpm add -D vitest` names vitest and not `-D`.
// A package name starts with a word character or an `@scope`.
const PACKAGE_ADDED_RE = /\b(?:pnpm|npm|yarn)\s+(?:add|i)\s+(?:-\S+\s+)*([\w@][\w@./-]*)/iu;
const PACKAGE_REMOVED_RE = /\b(?:pnpm|npm|yarn)\s+(?:remove|uninstall)\s+(?:-\S+\s+)*([\w@][\w@./-]*)/iu;
const PACKAGE_INSTALL_RE = /\b(?:pnpm|npm|yarn)\s+install\b/iu;

function matchAction(command: string, table: ActionTable): NarrationSubject {
  const phrase = table.find(([re]) => re.test(command))?.[1];
  return phrase ? { kind: "action", phrase } : NONE;
}

function installAction(command: string): NarrationSubject {
  const added = command.match(PACKAGE_ADDED_RE);
  if (added) return { kind: "action", phrase: `${clip(added[1], MAX_PACKAGE_NAME_LENGTH)} を追加` };

  const removed = command.match(PACKAGE_REMOVED_RE);
  if (removed) return { kind: "action", phrase: `${clip(removed[1], MAX_PACKAGE_NAME_LENGTH)} を削除` };

  return PACKAGE_INSTALL_RE.test(command) ? { kind: "action", phrase: "依存を準備" } : NONE;
}

function checkLabel(detail: string): string {
  const runner = representativeGlossaryTerm(detail, "test");
  return runner === "tsc" || runner === "typecheck" ? "型チェック" : "自動テスト";
}

/**
 * Derive the subject of `ev` for the narration layer. Returns `NONE` whenever
 * the detail does not identify something concrete, so callers keep their
 * existing generic sentence instead of inventing a target.
 */
export function describeNarrationSubject(ev: Event): NarrationSubject {
  const detail = ev.detail?.trim();
  if (!detail) return NONE;

  switch (ev.type) {
    case "read":
      return fileSubject(extractReadTarget(detail));
    case "write":
      return fileSubject(extractWriteTarget(detail));
    case "search": {
      const command = detailCommand(detail);
      const term = extractSearchPattern(detail);
      if (term && SAFE_TERM_RE.test(term)) {
        return { kind: "searchTerm", term: clip(term, MAX_SEARCH_TERM_LENGTH) };
      }
      if (isFileListExecution(command)) return { kind: "fileList" };
      return NONE;
    }
    case "test": {
      return testResult(detail) ?? { kind: "check", label: checkLabel(detail) };
    }
    case "git":
      return matchAction(detailCommand(detail), GIT_ACTIONS);
    case "github":
      return matchAction(detailCommand(detail), GITHUB_ACTIONS);
    case "install":
      return installAction(detailCommand(detail));
    case "server":
      return SERVER_STARTED_RE.test(detail)
        ? { kind: "action", phrase: "サーバーの起動を確認" }
        : { kind: "action", phrase: "サーバーを起動" };
    // `build` and `lint` carry nothing beyond what the event type already says,
    // and `error` is urgent priority, so its speech never comes from narration.
    default:
      return NONE;
  }
}
