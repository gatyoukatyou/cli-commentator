import type { Event, Style } from "../types.js";
import { describeBashMeaning, detailCommand, extractReadTarget, extractSearchTerm, extractWriteTarget, say } from "./bash-meaning.js";

function contextualBeginnerLine(ev: Event, style: Style): string | null {
  const detail = ev.detail?.trim();
  const command = detailCommand(detail);

  if (detail && /^[⏺•]\s*Read\(/.test(detail)) {
    const target = extractReadTarget(detail) ?? "対象ファイル";
    const isDoc = /\.(md|txt|rst|adoc)$/i.test(target) || /readme|docs?/i.test(target);
    return say(style, {
      standard: `1行メモ: ${target} を読んで、${isDoc ? "手順や前提" : "現在の実装"}を確認しています。`,
      kansai: `1行メモ: ${target} を読んで、${isDoc ? "手順や前提" : "今の実装"}を確認してるで。`,
      zundamon: `1行メモ: ${target} を読んで、${isDoc ? "手順や前提" : "今の実装"}を確認してるのだ。`,
    });
  }

  if (detail && /^[⏺•]\s*(Update|Write)\(/.test(detail)) {
    const target = extractWriteTarget(detail) ?? "対象ファイル";
    return say(style, {
      standard: `1行メモ: ${target} を書き換えて、挙動を直接調整しています。`,
      kansai: `1行メモ: ${target} を書き換えて、挙動を直接調整してるで。`,
      zundamon: `1行メモ: ${target} を書き換えて、挙動を直接調整してるのだ。`,
    });
  }

  if (detail && /\bapply_patch\b|apply patch/i.test(detail)) {
    return say(style, {
      standard: "1行メモ: 変更差分をまとめて当てて、複数箇所を一気に更新しています。",
      kansai: "1行メモ: 変更差分まとめて当てて、複数箇所を一気に更新してるで。",
      zundamon: "1行メモ: 変更差分をまとめて当てて、複数箇所を一気に更新してるのだ。",
    });
  }

  if (ev.type === "search" && /\b(rg|grep)\b/i.test(command)) {
    const term = extractSearchTerm(command);
    return say(style, {
      standard: `1行メモ: ${term ? `「${term}」を手がかりに` : ""}プロジェクト全体を横断検索して、関係する場所を絞っています。`,
      kansai: `1行メモ: ${term ? `「${term}」を手がかりに` : ""}プロジェクト全体を横断検索して、関係ある場所しぼってるで。`,
      zundamon: `1行メモ: ${term ? `「${term}」を手がかりに` : ""}プロジェクト全体を横断検索して、関係ある場所をしぼってるのだ。`,
    });
  }

  if (ev.type === "github" && /\bgh\s+pr\s+checks\b/i.test(command)) {
    return say(style, {
      standard: "1行メモ: PRの自動チェック結果を見て、公開前の安全確認をしています。",
      kansai: "1行メモ: PRの自動チェック結果見て、公開前の安全確認してるで。",
      zundamon: "1行メモ: PRの自動チェック結果を見て、公開前の安全確認をしてるのだ。",
    });
  }

  if ((ev.type === "git" || ev.type === "github") && /\bgit\s+status\b/i.test(command)) {
    return say(style, {
      standard: "1行メモ: 変更されたファイル一覧を見て、今どこまで触ったか確認しています。",
      kansai: "1行メモ: 変更されたファイル一覧を見て、今どこまで触ったか確認してるで。",
      zundamon: "1行メモ: 変更されたファイル一覧を見て、今どこまで触ったか確認してるのだ。",
    });
  }

  if (ev.type === "test" && /\b(tsc|typecheck)\b/i.test(command)) {
    return say(style, {
      standard: "1行メモ: プログラム同士のつながりが噛み合っているか、型ルールで機械確認しています。",
      kansai: "1行メモ: プログラム同士のつながり合ってるか、型ルールで機械確認してるで。",
      zundamon: "1行メモ: プログラム同士のつながりが合ってるか、型ルールで機械確認してるのだ。",
    });
  }

  if (ev.type === "test" && /\b(test|vitest|jest|playwright)\b/i.test(command)) {
    return say(style, {
      standard: "1行メモ: 変更の副作用がないか、自動テストで機械的に確認しています。",
      kansai: "1行メモ: 変更の副作用ないか、自動テストで機械的に確認してるで。",
      zundamon: "1行メモ: 変更の副作用がないか、自動テストで機械的に確認してるのだ。",
    });
  }

  if (ev.type === "install" && /\b(pnpm|npm|yarn)\s+install\b/i.test(command)) {
    return say(style, {
      standard: "1行メモ: 必要な部品をそろえて、この環境で動く状態にしています。",
      kansai: "1行メモ: 必要な部品そろえて、この環境で動く状態にしてるで。",
      zundamon: "1行メモ: 必要な部品をそろえて、この環境で動く状態にしてるのだ。",
    });
  }

  if (ev.type === "error" && /\bTS\d{4,5}\b/i.test(detail ?? "")) {
    return say(style, {
      standard: "1行メモ: TypeScript が『データや部品のつながりが合っていない』箇所を知らせています。",
      kansai: "1行メモ: TypeScript が『データや部品のつながり合ってへん』場所を知らせてるで。",
      zundamon: "1行メモ: TypeScript が『データや部品のつながりが合ってない』場所を知らせてるのだ。",
    });
  }

  if (ev.type === "stdout" && detail && /^[⏺•]\s*Bash\(/.test(detail)) {
    return `1行メモ: ${describeBashMeaning(command, style).memo}`;
  }

  return null;
}


type BeginnerLineTable = Record<Event["type"] | "default", Record<Style, string>>;

const BEGINNER_LINES: BeginnerLineTable = {
  read: { standard: "1行メモ: 現状を把握して次の修正方針を決めています。", kansai: "1行メモ: 今の状況つかんで次の手を決めてるとこや。", zundamon: "1行メモ: 今の状況をつかんで次の手を決めてるのだ。" },
  stdout: { standard: "1行メモ: コマンドの通常出力を確認しています。", kansai: "1行メモ: コマンドの通常出力を確認してるで。", zundamon: "1行メモ: コマンドの通常出力を確認してるのだ。" },
  stderr: { standard: "1行メモ: エラー出力を確認して原因を絞っています。", kansai: "1行メモ: エラー出力を見て原因しぼってるで。", zundamon: "1行メモ: エラー出力を見て原因をしぼってるのだ。" },
  write: { standard: "1行メモ: 問題を直すために内容を更新しています。", kansai: "1行メモ: 問題直すために中身を更新してるで。", zundamon: "1行メモ: 問題を直すために中身を更新してるのだ。" },
  search: { standard: "1行メモ: 手がかりを探して調査範囲を絞っています。", kansai: "1行メモ: 手がかり探して調査範囲しぼってるで。", zundamon: "1行メモ: 手がかりを探して調査範囲をしぼってるのだ。" },
  test: { standard: "1行メモ: 変更で壊れていないか確認しています。", kansai: "1行メモ: 変更で壊れてへんか確認してるで。", zundamon: "1行メモ: 変更で壊れてないか確認してるのだ。" },
  build: { standard: "1行メモ: 実行・配布できる形にまとめています。", kansai: "1行メモ: 実行・配布できる形にまとめてるで。", zundamon: "1行メモ: 実行・配布できる形にまとめてるのだ。" },
  lint: { standard: "1行メモ: 読みやすさと品質ルールを確認しています。", kansai: "1行メモ: 読みやすさと品質ルールを確認してるで。", zundamon: "1行メモ: 読みやすさと品質ルールを確認してるのだ。" },
  server: { standard: "1行メモ: 動作確認のため実行環境を立ち上げています。", kansai: "1行メモ: 動作確認のため実行環境を立ち上げてるで。", zundamon: "1行メモ: 動作確認のため実行環境を立ち上げてるのだ。" },
  git: { standard: "1行メモ: 変更履歴を整理して戻せる状態にしています。", kansai: "1行メモ: 変更履歴を整理して戻せる状態にしてるで。", zundamon: "1行メモ: 変更履歴を整理して戻せる状態にしてるのだ。" },
  github: { standard: "1行メモ: Issue/PRで作業状況を同期しています。", kansai: "1行メモ: Issue/PRで作業状況を同期してるで。", zundamon: "1行メモ: Issue/PRで作業状況を同期してるのだ。" },
  install: { standard: "1行メモ: 必要なツールや依存を揃えています。", kansai: "1行メモ: 必要なツールや依存をそろえてるで。", zundamon: "1行メモ: 必要なツールや依存をそろえてるのだ。" },
  error: { standard: "1行メモ: 失敗ログを手がかりに修正方針を決めます。", kansai: "1行メモ: 失敗ログを手がかりに直し方を決めるで。", zundamon: "1行メモ: 失敗ログを手がかりに直し方を決めるのだ。" },
  start: { standard: "1行メモ: これから作業の流れを順に追います。", kansai: "1行メモ: これから作業の流れを順に追うで。", zundamon: "1行メモ: これから作業の流れを順に追うのだ。" },
  done: { standard: "1行メモ: 作業がひと区切りで、結果を確認しています。", kansai: "1行メモ: ひと区切りついたから結果を確認してるで。", zundamon: "1行メモ: ひと区切りついたので結果を確認してるのだ。" },
  default: { standard: "1行メモ: 状況を見ながら次の手を選んでいます。", kansai: "1行メモ: 状況見ながら次の手を選んでるで。", zundamon: "1行メモ: 状況を見ながら次の手を選んでるのだ。" },
};

export function beginnerOneLine(ev: Event, style: Style): string {
  const contextual = contextualBeginnerLine(ev, style);
  if (contextual) return contextual;
  return (BEGINNER_LINES[ev.type] ?? BEGINNER_LINES.default)[style];
}
