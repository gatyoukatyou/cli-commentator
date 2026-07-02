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

export function getGlossaryNotes(detail?: string): string[] {
  if (!detail) return [];
  return Array.from(new Set(GLOSSARY.filter((g) => g.re.test(detail)).map((g) => g.note)));
}
