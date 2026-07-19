import type { Style } from "../types.js";
import { extractSearchPattern } from "../command-analysis.js";

export function say(style: Style, text: Record<Style, string>): string {
  return text[style];
}

function basenameFromPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || value;
}

export function extractReadTarget(detail?: string): string | null {
  if (!detail) return null;
  const match = detail.match(/^[⏺•]\s*Read\((.+)\)$/);
  if (!match) return null;
  return basenameFromPath(match[1].trim());
}

export function extractWriteTarget(detail?: string): string | null {
  if (!detail) return null;
  const match = detail.match(/^[⏺•]\s*(?:Update|Write)\((.+)\)$/);
  if (!match) return null;
  return basenameFromPath(match[1].trim());
}

export function extractSearchTerm(detail?: string): string | null {
  if (!detail) return null;
  return extractSearchPattern(detail);
}

export function detailCommand(detail?: string): string {
  if (!detail) return "";
  const bashMatch = detail.match(/^[⏺•]\s*Bash\((.+)\)$/);
  if (bashMatch) return bashMatch[1].trim();
  return detail.trim();
}

function compactCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

export function describeBashMeaning(command: string, style: Style): { spotlight: string; memo: string } {
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
