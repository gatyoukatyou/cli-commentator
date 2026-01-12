import type { Event, Style } from "../types.js";
import { commentStandard } from "./standard.js";
import { commentKansai } from "./kansai.js";
import { commentZundamon } from "./zundamon.js";
import { createLLMAdapter } from "../llm/factory.js";
import type { LLMAdapter } from "../llm/adapter.js";

const LLM_PROVIDER = (process.env.LLM_PROVIDER ?? "").trim().toLowerCase();

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

function commentByRules(ev: Event, style: Style): string {
  const beginner = "初心者向け1行解説つき。";
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

export async function comment(ev: Event, style: Style): Promise<string> {
  // 1) provider未指定 → 従来ルール実況
  if (!LLM_PROVIDER) {
    return commentByRules(ev, style);
  }

  // 2) provider指定あり → まずLLMを試す（失敗したら従来へ）
  try {
    if (!llm) {
      return commentByRules(ev, style);
    }

    const prompt = buildLLMPrompt(ev, style);
    const res = await llm.generateText({
      messages: [{ role: "user", content: prompt }],
    });

    if (res.text && res.text.trim()) {
      return res.text.trim();
    }
    return commentByRules(ev, style);
  } catch {
    return commentByRules(ev, style);
  }
}
