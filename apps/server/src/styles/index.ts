import type { Event, Style } from "../types.js";
import { commentStandard } from "./standard.js";
import { commentKansai } from "./kansai.js";
import { commentZundamon } from "./zundamon.js";
import { createLLMAdapter } from "../llm/factory.js";
import type { LLMAdapter } from "../llm/adapter.js";
import { CommentError } from "../errors.js";
import { withTimeout } from "../utils/timeout.js";

const LLM_PROVIDER = (process.env.LLM_PROVIDER ?? "").trim().toLowerCase();
const COMMENT_TIMEOUT_MS = parseInt(process.env.COMMENT_TIMEOUT_MS ?? "3000", 10);

// --- Logging ---
type CommentLogMeta = {
  provider: string;
  style: string;
  eventType: string;
};

function logComment(
  result: "ok" | "timeout" | "aborted" | "llm_error",
  durationMs: number,
  meta: CommentLogMeta
): void {
  const msg = `comment_${result} duration_ms=${durationMs} provider=${meta.provider} style=${meta.style} event=${meta.eventType}`;
  if (result === "ok") {
    if (process.env.DEBUG) console.log(msg);
  } else {
    console.warn(msg);
  }
}

// 起動時に1回だけ作る（未実装providerでも落とさない）
const llm: LLMAdapter | null = (() => {
  if (!LLM_PROVIDER) return null;
  try {
    return createLLMAdapter();
  } catch {
    return null;
  }
})();

const GLOSSARY: Array<{ re: RegExp; note: string }> = [
  { re: /\brg\b/, note: "rg= ripgrep（高速grep）" },
  { re: /\btsc\b|\btypecheck\b/i, note: "tsc/typecheck=型チェック（TypeScript）" },
  { re: /\bpnpm\b|\bnpm\b|\byarn\b/i, note: "依存関係の操作（パッケージ管理）" },
  { re: /\bvite\b/i, note: "Vite=開発用の高速フロントエンド環境" },
  { re: /\btsx\b/i, note: "tsx=TypeScriptを実行するランタイム" },
  { re: /\bnode-pty\b|\bpty\b/i, note: "pty=擬似端末（CLIを包んで実行）" },
  { re: /\bws\b|\bwebsocket\b/i, note: "WebSocket=双方向通信" },
  { re: /\bplaywright\b/i, note: "Playwright=ブラウザ自動化テスト" },
  { re: /\bvitest\b|\bjest\b/i, note: "Vitest/Jest=テスト実行" },
  { re: /\bgh\b/i, note: "gh=GitHub CLI" },
  { re: /\bgit\b/i, note: "git=履歴管理" }
];

function annotate(detail?: string): string {
  if (!detail) return "";
  const hits = GLOSSARY.filter((g) => g.re.test(detail)).map((g) => g.note);
  return hits.length ? `（${Array.from(new Set(hits)).join(" / ")}）` : "";
}

type BeginnerLineTable = Record<Event["type"], string> & { default: string };

const BEGINNER_STANDARD: BeginnerLineTable = {
  read: "1行メモ: 現状を把握して次の修正方針を決めています。",
  write: "1行メモ: 問題を直すために内容を更新しています。",
  search: "1行メモ: 手がかりを探して調査範囲を絞っています。",
  test: "1行メモ: 変更で壊れていないか確認しています。",
  build: "1行メモ: 実行・配布できる形にまとめています。",
  lint: "1行メモ: 読みやすさと品質ルールを確認しています。",
  server: "1行メモ: 動作確認のため実行環境を立ち上げています。",
  git: "1行メモ: 変更履歴を整理して戻せる状態にしています。",
  github: "1行メモ: Issue/PRで作業状況を同期しています。",
  install: "1行メモ: 必要なツールや依存を揃えています。",
  error: "1行メモ: 失敗ログを手がかりに修正方針を決めます。",
  start: "1行メモ: これから作業の流れを順に追います。",
  done: "1行メモ: 作業がひと区切りで、結果を確認しています。",
  default: "1行メモ: 状況を見ながら次の手を選んでいます。",
};

const BEGINNER_KANSAI: BeginnerLineTable = {
  read: "1行メモ: 今の状況つかんで次の手を決めてるとこや。",
  write: "1行メモ: 問題直すために中身を更新してるで。",
  search: "1行メモ: 手がかり探して調査範囲しぼってるで。",
  test: "1行メモ: 変更で壊れてへんか確認してるで。",
  build: "1行メモ: 実行・配布できる形にまとめてるで。",
  lint: "1行メモ: 読みやすさと品質ルールを確認してるで。",
  server: "1行メモ: 動作確認のため実行環境を立ち上げてるで。",
  git: "1行メモ: 変更履歴を整理して戻せる状態にしてるで。",
  github: "1行メモ: Issue/PRで作業状況を同期してるで。",
  install: "1行メモ: 必要なツールや依存をそろえてるで。",
  error: "1行メモ: 失敗ログを手がかりに直し方を決めるで。",
  start: "1行メモ: これから作業の流れを順に追うで。",
  done: "1行メモ: ひと区切りついたから結果を確認してるで。",
  default: "1行メモ: 状況見ながら次の手を選んでるで。",
};

const BEGINNER_ZUNDAMON: BeginnerLineTable = {
  read: "1行メモ: 今の状況をつかんで次の手を決めてるのだ。",
  write: "1行メモ: 問題を直すために中身を更新してるのだ。",
  search: "1行メモ: 手がかりを探して調査範囲をしぼってるのだ。",
  test: "1行メモ: 変更で壊れてないか確認してるのだ。",
  build: "1行メモ: 実行・配布できる形にまとめてるのだ。",
  lint: "1行メモ: 読みやすさと品質ルールを確認してるのだ。",
  server: "1行メモ: 動作確認のため実行環境を立ち上げてるのだ。",
  git: "1行メモ: 変更履歴を整理して戻せる状態にしてるのだ。",
  github: "1行メモ: Issue/PRで作業状況を同期してるのだ。",
  install: "1行メモ: 必要なツールや依存をそろえてるのだ。",
  error: "1行メモ: 失敗ログを手がかりに直し方を決めるのだ。",
  start: "1行メモ: これから作業の流れを順に追うのだ。",
  done: "1行メモ: ひと区切りついたので結果を確認してるのだ。",
  default: "1行メモ: 状況を見ながら次の手を選んでるのだ。",
};

function beginnerOneLine(ev: Event, style: Style): string {
  const table =
    style === "kansai" ? BEGINNER_KANSAI :
    style === "zundamon" ? BEGINNER_ZUNDAMON :
    BEGINNER_STANDARD;

  return table[ev.type] ?? table.default;
}

function commentByRules(ev: Event, style: Style): string {
  const beginner = beginnerOneLine(ev, style);
  const note = annotate(ev.detail);

  const core =
    style === "kansai" ? commentKansai(ev) :
    style === "zundamon" ? commentZundamon(ev) :
    commentStandard(ev);

  return `${core} ${beginner}${note ? " " + note : ""}`;
}

function buildLLMPrompt(ev: Event, style: Style): string {
  const styleDesc =
    style === "kansai" ? "関西弁で" :
    style === "zundamon" ? "ずんだもん風（〜なのだ）で" :
    "標準的な日本語で";

  return `あなたはCLI操作の実況者です。${styleDesc}、以下のイベントを1文で実況してください。
イベント種別: ${ev.type}
要約: ${ev.summary}${ev.detail ? `\n詳細: ${ev.detail}` : ""}

回答は実況コメント1文のみ（説明不要）:`;
}

async function commentInternal(ev: Event, style: Style, signal?: AbortSignal): Promise<string> {
  // 1) provider未指定 or disabled → 従来ルール実況
  if (!LLM_PROVIDER || LLM_PROVIDER === "disabled") {
    return commentByRules(ev, style);
  }

  // 2) provider指定あり → LLMを試す（エラーは上位で処理）
  if (!llm) {
    return commentByRules(ev, style);
  }

  const prompt = buildLLMPrompt(ev, style);
  const res = await llm.generateText({
    messages: [{ role: "user", content: prompt }],
    signal,
  });

  if (res.text && res.text.trim()) {
    return res.text.trim();
  }

  // 空レスポンス → LLMエラーとして扱う
  throw new CommentError("comment_llm_error", "Empty LLM response");
}

/**
 * comment() with timeout protection and logging.
 * If LLM call takes longer than COMMENT_TIMEOUT_MS, abort and fallback to rules.
 */
export async function comment(ev: Event, style: Style): Promise<string> {
  const meta: CommentLogMeta = {
    provider: LLM_PROVIDER || "disabled",
    style,
    eventType: ev.type,
  };

  // ルールベースのみの場合はタイムアウト不要
  if (!LLM_PROVIDER || LLM_PROVIDER === "disabled" || !llm) {
    return commentByRules(ev, style);
  }

  const controller = new AbortController();
  const start = Date.now();

  try {
    const result = await withTimeout(
      commentInternal(ev, style, controller.signal),
      {
        ms: COMMENT_TIMEOUT_MS,
        timeoutError: () => new CommentError("comment_timeout"),
        onTimeout: () => controller.abort(),
      }
    );
    logComment("ok", Date.now() - start, meta);
    return result;
  } catch (err) {
    const duration = Date.now() - start;
    if (err instanceof CommentError) {
      const resultType = err.code.replace("comment_", "") as "timeout" | "aborted" | "llm_error";
      logComment(resultType, duration, meta);
    } else {
      logComment("llm_error", duration, meta);
    }
    return commentByRules(ev, style);
  }
}
