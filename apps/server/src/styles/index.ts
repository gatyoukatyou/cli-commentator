import type { Event, Style } from "../types.js";
import { commentStandard } from "./standard.js";
import { commentKansai } from "./kansai.js";
import { commentZundamon } from "./zundamon.js";

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

export function comment(ev: Event, style: Style): string {
  const beginner = "初心者向け1行解説つき。";
  const note = annotate(ev.detail);

  const core =
    style === "kansai" ? commentKansai(ev) :
    style === "zundamon" ? commentZundamon(ev) :
    commentStandard(ev);

  return `${core} ${beginner}${note ? " " + note : ""}`;
}
