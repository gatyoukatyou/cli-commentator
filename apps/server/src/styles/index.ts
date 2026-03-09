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
  { re: /\brg\b/, note: "補足: rg はプロジェクト全体を高速検索するコマンド" },
  { re: /\btsc\b|\btypecheck\b/i, note: "補足: tsc/typecheck は型の整合性を自動確認するチェック" },
  { re: /\bpnpm\b|\bnpm\b|\byarn\b/i, note: "補足: pnpm/npm/yarn は依存関係やスクリプト実行に使う" },
  { re: /\bvite\b/i, note: "補足: Vite はフロントエンド開発用の高速実行環境" },
  { re: /\btsx\b/i, note: "補足: tsx は TypeScript をそのまま実行する仕組み" },
  { re: /\bnode-pty\b|\bpty\b/i, note: "補足: pty は CLI を仮想端末として包んで動かす仕組み" },
  { re: /\bws\b|\bwebsocket\b/i, note: "補足: WebSocket は画面とサーバーをつなぐ常時接続" },
  { re: /\bplaywright\b/i, note: "補足: Playwright はブラウザ操作を自動で試すテスト" },
  { re: /\bvitest\b|\bjest\b/i, note: "補足: Vitest/Jest は自動テストを走らせる仕組み" },
  { re: /\bgh\b/i, note: "補足: gh は GitHub を操作する公式CLI" },
  { re: /\bgit\b/i, note: "補足: git は変更履歴を管理する仕組み" }
];

function annotate(detail?: string): string {
  if (!detail) return "";
  const hits = GLOSSARY.filter((g) => g.re.test(detail)).map((g) => g.note);
  return hits.length ? `（${Array.from(new Set(hits)).join(" / ")}）` : "";
}

const DETAIL_PREVIEW_MAX = 96;

function detailPreview(detail?: string): string {
  if (!detail) return "";
  const compact = detail.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= DETAIL_PREVIEW_MAX) return compact;
  return `${compact.slice(0, DETAIL_PREVIEW_MAX - 1).trimEnd()}…`;
}

function detailSpotlight(ev: Event, style: Style): string {
  const preview = detailPreview(ev.detail);
  if (!preview) return "";

  if (ev.type === "stdout") {
    if (/^[⏺•]\s*Bash\(/.test(ev.detail ?? "")) {
      return describeBashMeaning(detailCommand(ev.detail), style).spotlight;
    }
    return style === "kansai"
      ? `今見えてる出力は「${preview}」や。`
      : style === "zundamon"
        ? `今見えてる出力は「${preview}」なのだ。`
        : `今見えている出力は「${preview}」です。`;
  }

  if (ev.type === "stderr" || ev.type === "error") {
    return style === "kansai"
      ? `引っかかってる行は「${preview}」や。`
      : style === "zundamon"
        ? `引っかかってる行は「${preview}」なのだ。`
        : `引っかかっている行は「${preview}」です。`;
  }

  return "";
}

type BeginnerLineTable = Record<Event["type"], string> & { default: string };

function say(style: Style, text: { standard: string; kansai: string; zundamon: string }): string {
  return style === "kansai" ? text.kansai : style === "zundamon" ? text.zundamon : text.standard;
}

function basenameFromPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || value;
}

function extractReadTarget(detail?: string): string | null {
  if (!detail) return null;
  const match = detail.match(/^[⏺•]\s*Read\((.+)\)$/);
  if (!match) return null;
  return basenameFromPath(match[1].trim());
}

function extractWriteTarget(detail?: string): string | null {
  if (!detail) return null;
  const match = detail.match(/^[⏺•]\s*(?:Update|Write)\((.+)\)$/);
  if (!match) return null;
  return basenameFromPath(match[1].trim());
}

function extractSearchTerm(detail?: string): string | null {
  if (!detail) return null;
  const quoted =
    detail.match(/"(.*?)"/)?.[1] ??
    detail.match(/'(.*?)'/)?.[1] ??
    detail.match(/`(.*?)`/)?.[1];
  if (quoted) return quoted.trim();

  const grepMatch = detail.match(/\b(?:rg|grep)\b(?:\s+-\S+|\s+--\S+)*\s+([^\s][^|&;]*)/i);
  return grepMatch ? grepMatch[1].trim() : null;
}

function detailCommand(detail?: string): string {
  if (!detail) return "";
  const bashMatch = detail.match(/^[⏺•]\s*Bash\((.+)\)$/);
  if (bashMatch) return bashMatch[1].trim();
  return detail.trim();
}

function compactCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

function describeBashMeaning(command: string, style: Style): { spotlight: string; memo: string } {
  const compact = compactCommand(command);
  const hasSsh = /^\s*ssh\b/i.test(compact);
  const hasDockerPs = /\bdocker\s+ps\b/i.test(compact);
  const hasDockerCompose = /\bdocker\s+compose\b/i.test(compact);
  const hasHostname = /\bhostname\b/i.test(compact);
  const hasFind = /\b(find|fd)\b/i.test(compact);
  const hasGrep = /\b(rg|grep)\b/i.test(compact);
  const hasGitStatus = /\bgit\s+status\b/i.test(compact);
  const hasGhPrChecks = /\bgh\s+pr\s+checks\b/i.test(compact);
  const hasInstall = /\b(pnpm|npm|yarn)\s+(install|add|i)\b/i.test(compact);
  const hasTypecheck = /\b(tsc|typecheck)\b/i.test(compact);
  const hasTests = /\b(playwright|vitest|jest|\btest\b)\b/i.test(compact);
  const hasReadFile = /\b(cat|sed|head|tail|less|more)\b/i.test(compact);

  if (hasSsh && hasDockerPs) {
    return {
      spotlight: say(style, {
        standard: "いまやっているのは、リモートサーバーに接続して Docker コンテナの稼働状況を確認する作業です。",
        kansai: "今やってるのは、リモートサーバー入って Docker コンテナの動作状況を確認する作業や。",
        zundamon: "今やってるのは、リモートサーバーに入って Docker コンテナの動作状況を確認する作業なのだ。",
      }),
      memo: say(style, {
        standard: `${hasHostname ? "接続先が正しいかを確かめつつ、" : ""}サーバー上で今どのサービスが動いているか棚卸ししています。`,
        kansai: `${hasHostname ? "接続先が合ってるか確かめつつ、" : ""}サーバー上で今どのサービス動いてるか棚卸ししてるで。`,
        zundamon: `${hasHostname ? "接続先が合ってるか確かめつつ、" : ""}サーバー上で今どのサービスが動いてるか棚卸ししてるのだ。`,
      }),
    };
  }

  if (hasSsh && hasFind && hasGrep) {
    return {
      spotlight: say(style, {
        standard: "いまやっているのは、リモートサーバーに接続して設定ファイルの場所を探す作業です。",
        kansai: "今やってるのは、リモートサーバー入って設定ファイルの場所を探す作業や。",
        zundamon: "今やってるのは、リモートサーバーに入って設定ファイルの場所を探す作業なのだ。",
      }),
      memo: say(style, {
        standard: "どこに設定が置かれているかを見つけて、次に直す場所を特定しています。",
        kansai: "どこに設定置かれてるか見つけて、次に直す場所を特定してるで。",
        zundamon: "どこに設定が置かれてるか見つけて、次に直す場所を特定してるのだ。",
      }),
    };
  }

  if (hasSsh) {
    return {
      spotlight: say(style, {
        standard: "いまやっているのは、リモートサーバーに接続して現地の状態を直接確認する作業です。",
        kansai: "今やってるのは、リモートサーバー入って現地の状態を直接確認する作業や。",
        zundamon: "今やってるのは、リモートサーバーに入って現地の状態を直接確認する作業なのだ。",
      }),
      memo: say(style, {
        standard: "手元の予想ではなく、実際のサーバー環境を見て判断材料を集めています。",
        kansai: "手元の予想やなくて、実際のサーバー環境見て判断材料集めてるで。",
        zundamon: "手元の予想ではなく、実際のサーバー環境を見て判断材料を集めてるのだ。",
      }),
    };
  }

  if (hasDockerCompose) {
    return {
      spotlight: say(style, {
        standard: "いまやっているのは、Docker Compose でサービス群の状態を確認・操作する作業です。",
        kansai: "今やってるのは、Docker Compose でサービス全体の状態を確認・操作する作業や。",
        zundamon: "今やってるのは、Docker Compose でサービス全体の状態を確認・操作する作業なのだ。",
      }),
      memo: say(style, {
        standard: "複数の関連サービスをまとめて扱って、環境全体がどう動いているかを見ています。",
        kansai: "関連するサービスまとめて扱って、環境全体がどう動いてるか見てるで。",
        zundamon: "関連するサービスをまとめて扱って、環境全体がどう動いてるか見てるのだ。",
      }),
    };
  }

  if (hasDockerPs) {
    return {
      spotlight: say(style, {
        standard: "いまやっているのは、Docker コンテナの稼働状況を確認する作業です。",
        kansai: "今やってるのは、Docker コンテナの稼働状況を確認する作業や。",
        zundamon: "今やってるのは、Docker コンテナの稼働状況を確認する作業なのだ。",
      }),
      memo: say(style, {
        standard: "裏側で動いているサービス一覧を見て、落ちているものがないか確認しています。",
        kansai: "裏で動いてるサービス一覧見て、落ちてるもんないか確認してるで。",
        zundamon: "裏側で動いてるサービス一覧を見て、落ちてるものがないか確認してるのだ。",
      }),
    };
  }

  if (hasGhPrChecks) {
    return {
      spotlight: say(style, {
        standard: "いまやっているのは、PR の自動チェック結果を確認する作業です。",
        kansai: "今やってるのは、PR の自動チェック結果を確認する作業や。",
        zundamon: "今やってるのは、PR の自動チェック結果を確認する作業なのだ。",
      }),
      memo: say(style, {
        standard: "公開前の安全確認として、自動テストや解析が通っているか見ています。",
        kansai: "公開前の安全確認として、自動テストや解析が通ってるか見てるで。",
        zundamon: "公開前の安全確認として、自動テストや解析が通ってるか見てるのだ。",
      }),
    };
  }

  if (hasGitStatus) {
    return {
      spotlight: say(style, {
        standard: "いまやっているのは、変更されたファイル一覧を確認する作業です。",
        kansai: "今やってるのは、変更されたファイル一覧を確認する作業や。",
        zundamon: "今やってるのは、変更されたファイル一覧を確認する作業なのだ。",
      }),
      memo: say(style, {
        standard: "今どこまで編集が進んだか、作業範囲を棚卸ししています。",
        kansai: "今どこまで編集進んだか、作業範囲を棚卸ししてるで。",
        zundamon: "今どこまで編集が進んだか、作業範囲を棚卸ししてるのだ。",
      }),
    };
  }

  if (hasInstall) {
    return {
      spotlight: say(style, {
        standard: "いまやっているのは、必要な部品や依存関係をそろえる作業です。",
        kansai: "今やってるのは、必要な部品や依存関係そろえる作業や。",
        zundamon: "今やってるのは、必要な部品や依存関係をそろえる作業なのだ。",
      }),
      memo: say(style, {
        standard: "この環境でプログラムが動くように、足りない材料を入れています。",
        kansai: "この環境でプログラム動くように、足りてへん材料入れてるで。",
        zundamon: "この環境でプログラムが動くように、足りない材料を入れてるのだ。",
      }),
    };
  }

  if (hasTypecheck) {
    return {
      spotlight: say(style, {
        standard: "いまやっているのは、型ルールでプログラムのつながりを確認する作業です。",
        kansai: "今やってるのは、型ルールでプログラムのつながり確認する作業や。",
        zundamon: "今やってるのは、型ルールでプログラムのつながりを確認する作業なのだ。",
      }),
      memo: say(style, {
        standard: "データや部品の受け渡しが食い違っていないか、機械的に確認しています。",
        kansai: "データや部品の受け渡し食い違ってへんか、機械的に確認してるで。",
        zundamon: "データや部品の受け渡しが食い違ってないか、機械的に確認してるのだ。",
      }),
    };
  }

  if (hasTests) {
    return {
      spotlight: say(style, {
        standard: "いまやっているのは、自動テストで動作確認する作業です。",
        kansai: "今やってるのは、自動テストで動作確認する作業や。",
        zundamon: "今やってるのは、自動テストで動作確認する作業なのだ。",
      }),
      memo: say(style, {
        standard: "変更のせいで別の部分が壊れていないか、まとめて確かめています。",
        kansai: "変更のせいで別の部分壊れてへんか、まとめて確かめてるで。",
        zundamon: "変更のせいで別の部分が壊れてないか、まとめて確かめてるのだ。",
      }),
    };
  }

  if (hasReadFile) {
    return {
      spotlight: say(style, {
        standard: "いまやっているのは、ファイルの中身を直接確認する作業です。",
        kansai: "今やってるのは、ファイルの中身を直接確認する作業や。",
        zundamon: "今やってるのは、ファイルの中身を直接確認する作業なのだ。",
      }),
      memo: say(style, {
        standard: "設定やログの実物を見て、仮説が合っているか確かめています。",
        kansai: "設定やログの実物見て、仮説合ってるか確かめてるで。",
        zundamon: "設定やログの実物を見て、仮説が合ってるか確かめてるのだ。",
      }),
    };
  }

  if (hasFind && hasGrep) {
    return {
      spotlight: say(style, {
        standard: "いまやっているのは、条件に合うファイルや設定を探す作業です。",
        kansai: "今やってるのは、条件に合うファイルや設定探す作業や。",
        zundamon: "今やってるのは、条件に合うファイルや設定を探す作業なのだ。",
      }),
      memo: say(style, {
        standard: "直す場所や設定箇所を見つけるために、候補を絞り込んでいます。",
        kansai: "直す場所や設定箇所見つけるために、候補しぼり込んでるで。",
        zundamon: "直す場所や設定箇所を見つけるために、候補をしぼり込んでるのだ。",
      }),
    };
  }

  if (hasGrep) {
    const term = extractSearchTerm(compact);
    return {
      spotlight: say(style, {
        standard: `いまやっているのは、${term ? `「${term}」を手がかりに` : ""}関連箇所を探す作業です。`,
        kansai: `今やってるのは、${term ? `「${term}」を手がかりに` : ""}関連箇所探す作業や。`,
        zundamon: `今やってるのは、${term ? `「${term}」を手がかりに` : ""}関連箇所を探す作業なのだ。`,
      }),
      memo: say(style, {
        standard: "問題や設定に関係する記述がどこにあるか、横断的に探しています。",
        kansai: "問題や設定に関係ある記述がどこにあるか、横断的に探してるで。",
        zundamon: "問題や設定に関係する記述がどこにあるか、横断的に探してるのだ。",
      }),
    };
  }

  return {
    spotlight: say(style, {
      standard: "いまやっているのは、コマンドを実行して実際の挙動を確かめる作業です。",
      kansai: "今やってるのは、コマンド実行して実際の挙動を確かめる作業や。",
      zundamon: "今やってるのは、コマンドを実行して実際の挙動を確かめる作業なのだ。",
    }),
    memo: say(style, {
      standard: "推測だけで進めず、実際に動かした結果を見て判断しています。",
      kansai: "推測だけで進めんと、実際に動かした結果見て判断してるで。",
      zundamon: "推測だけで進めず、実際に動かした結果を見て判断してるのだ。",
    }),
  };
}

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

const BEGINNER_STANDARD: BeginnerLineTable = {
  read: "1行メモ: 現状を把握して次の修正方針を決めています。",
  stdout: "1行メモ: コマンドの通常出力を確認しています。",
  stderr: "1行メモ: エラー出力を確認して原因を絞っています。",
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
  stdout: "1行メモ: コマンドの通常出力を確認してるで。",
  stderr: "1行メモ: エラー出力を見て原因しぼってるで。",
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
  stdout: "1行メモ: コマンドの通常出力を確認してるのだ。",
  stderr: "1行メモ: エラー出力を見て原因をしぼってるのだ。",
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
  const contextual = contextualBeginnerLine(ev, style);
  if (contextual) return contextual;

  const table =
    style === "kansai" ? BEGINNER_KANSAI :
    style === "zundamon" ? BEGINNER_ZUNDAMON :
    BEGINNER_STANDARD;

  return table[ev.type] ?? table.default;
}

function commentByRules(ev: Event, style: Style): string {
  const beginner = beginnerOneLine(ev, style);
  const note = annotate(ev.detail);
  const spotlight = detailSpotlight(ev, style);

  const core =
    style === "kansai" ? commentKansai(ev) :
    style === "zundamon" ? commentZundamon(ev) :
    commentStandard(ev);

  return [core, spotlight, beginner, note].filter(Boolean).join(" ");
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
