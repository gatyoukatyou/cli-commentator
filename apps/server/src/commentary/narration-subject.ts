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
  | { kind: "testResult"; passed: number | null; failed: number | null };

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
    default:
      return NONE;
  }
}
