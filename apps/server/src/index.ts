import "dotenv/config";
import http from "node:http";
import { WebSocketServer } from "ws";
import * as pty from "node-pty";

type Style = "standard" | "kansai" | "zundamon";

type EventType =
  | "start"
  | "stdout"
  | "stderr"
  | "read"
  | "write"
  | "search"
  | "test"
  | "git"
  | "github"
  | "install"
  | "error"
  | "done";

type Event = {
  ts: number;
  type: EventType;
  summary: string;
  detail?: string;
};

const PORT = Number(process.env.PORT ?? 8787);

// --- minimal redaction (MVP) ---
function redact(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*/g, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9]{20,}/g, "sk-[REDACTED]")
    .replace(/[A-Za-z0-9_\-]{32,}/g, (m) => (m.length >= 48 ? "[REDACTED_TOKEN]" : m));
}

const GLOSSARY: Array<{ re: RegExp; note: string }> = [
  { re: /\brg\b/, note: "rg= ripgrep（高速grep）" },
  { re: /\btsc\b|\btypecheck\b/i, note: "tsc/typecheck=型チェック（TypeScript）" },
  { re: /\bpnpm\b|\bnpm\b|\byarn\b/i, note: "依存関係の操作（パッケージ管理）" },
  { re: /\bgh\b/i, note: "gh=GitHub CLI" },
  { re: /\bgit\b/i, note: "git=履歴管理" }
];

function annotate(detail?: string): string {
  if (!detail) return "";
  const hits = GLOSSARY.filter((g) => g.re.test(detail)).map((g) => g.note);
  return hits.length ? `（${Array.from(new Set(hits)).join(" / ")}）` : "";
}

// Claude Code / Codex系ログ寄せのルール
const RULES: Array<{ re: RegExp; type: EventType; summary: string }> = [
  { re: /^[⏺•]\s*Read\(/, type: "read", summary: "ファイルを読み込んでいる" },
  { re: /^[⏺•]\s*Update\(/, type: "write", summary: "ファイルを更新している" },
  { re: /^[⏺•]\s*Write\(/, type: "write", summary: "ファイルを書き込んでいる" },
  { re: /^[⏺•]\s*Bash\(/, type: "stdout", summary: "コマンドを実行している" },

  { re: /\b(rg|grep)\b/i, type: "search", summary: "該当箇所を検索している" },
  { re: /\b(playwright|vitest|jest|test|typecheck|tsc)\b/i, type: "test", summary: "テスト/型チェックを実行している" },

  { re: /\bgh\s+(issue|pr|repo)\b/i, type: "github", summary: "GitHub操作をしている" },
  { re: /\bgit\s+(status|add|commit|push|pull|checkout|switch|merge|rebase)\b/i, type: "git", summary: "Git操作をしている" },

  { re: /\b(pnpm|npm|yarn)\s+(add|install|i|run)\b/i, type: "install", summary: "依存関係/スクリプトを処理している" },

  { re: /execution error|error|failed|exception|TS\d{5}/i, type: "error", summary: "エラーが出ている" }
];

function extractEvents(chunk: string): Event[] {
  const ts = Date.now();
  const lines = chunk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const events: Event[] = [];
  for (const line of lines) {
    const hit = RULES.find((r) => r.re.test(line));
    if (hit) events.push({ ts, type: hit.type, summary: hit.summary, detail: line });
    else events.push({ ts, type: "stdout", summary: "ログ更新", detail: line });
  }
  return events;
}

function comment(ev: Event, style: Style): string {
  const beginner = "初心者向け1行解説つき。";
  const note = annotate(ev.detail);

  const standard =
    ev.type === "read" ? "ファイルを読んで状況を確認しています。" :
    ev.type === "write" ? "ファイルを書き換えて修正を反映しています。" :
    ev.type === "search" ? "原因になりそうな箇所を検索しています。" :
    ev.type === "test" ? "テスト/型チェックで壊れていないか確認しています。" :
    ev.type === "git" ? "Gitで変更履歴を整理しています。" :
    ev.type === "github" ? "GitHub上のIssue/PRを操作しています。" :
    ev.type === "install" ? "依存関係の追加やスクリプト実行をしています。" :
    ev.type === "error" ? "エラーが出ています。原因特定→修正の流れになりそうです。" :
    ev.type === "start" ? "開始しました。これから作業の流れを実況します。" :
    ev.type === "done" ? "いったん区切りです。おつかれさまでした。" :
    "ログが進んでいます。";

  const kansai =
    ev.type === "read" ? "ファイル読んで状況確認してるで。" :
    ev.type === "write" ? "ファイル書き換えて修正反映してるで。" :
    ev.type === "search" ? "原因っぽいとこ探してるで。" :
    ev.type === "test" ? "テスト/型チェック回して確認中や。" :
    ev.type === "git" ? "Gitで変更まとめてるで。" :
    ev.type === "github" ? "GitHubのIssue/PR触ってるで。" :
    ev.type === "install" ? "依存関係やスクリプト処理してるで。" :
    ev.type === "error" ? "エラーや。原因特定して直す流れやな。" :
    ev.type === "start" ? "開始や。実況いくで。" :
    ev.type === "done" ? "ひとまず区切りや。おつかれさん。" :
    "ログ進んでるで。";

  const zunda =
    ev.type === "read" ? "ファイルを読んで状況確認してるのだ。" :
    ev.type === "write" ? "修正を反映して書き換えてるのだ。" :
    ev.type === "search" ? "原因になりそうな所を探してるのだ。" :
    ev.type === "test" ? "テスト/型チェックで確認してるのだ。" :
    ev.type === "git" ? "Gitで変更を整理してるのだ。" :
    ev.type === "github" ? "GitHubのIssue/PRを操作してるのだ。" :
    ev.type === "install" ? "依存関係やスクリプトを処理してるのだ。" :
    ev.type === "error" ? "エラーなのだ…原因を見つけて直すのだ。" :
    ev.type === "start" ? "開始なのだ！実況していくのだ。" :
    ev.type === "done" ? "いったん区切りなのだ。おつかれさまなのだ。" :
    "ログが進んでるのだ。";

  const core = style === "kansai" ? kansai : style === "zundamon" ? zunda : standard;
  return `${core} ${beginner}${note ? " " + note : ""}`;
}

// rate limit: max once per 2s (error is always allowed)
let lastEmit = 0;
function shouldEmitNow(): boolean {
  const now = Date.now();
  if (now - lastEmit >= 2000) {
    lastEmit = now;
    return true;
  }
  return false;
}

// --- HTTP + WS ---
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

let currentStyle: Style = "kansai";

function broadcast(obj: unknown) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "hello", style: currentStyle }));

  ws.on("message", (buf) => {
    try {
      const msg = JSON.parse(buf.toString());
      if (msg?.kind === "setStyle" && (msg.style === "standard" || msg.style === "kansai" || msg.style === "zundamon")) {
        currentStyle = msg.style;
        broadcast({ kind: "style", style: currentStyle });
      }
    } catch {}
  });
});

// --- Launch target CLI under PTY ---
const cmd = process.env.TARGET_CMD ?? "bash";
const args = process.env.TARGET_ARGS ? process.env.TARGET_ARGS.split(" ") : [];
const cwd = process.env.TARGET_CWD ?? process.cwd();

const term = pty.spawn(cmd, args, {
  name: "xterm-256color",
  cols: 120,
  rows: 30,
  cwd,
  env: process.env as Record<string, string>
});

// ローカル端末への表示は“生”のまま（実況/UIに出す時だけマスク）
term.onData((data) => process.stdout.write(data));

// 入力をPTYへ（対話CLIを一応動かせる）
if (process.stdin.isTTY) {
  try {
    process.stdin.setRawMode(true);
  } catch {}
  process.stdin.resume();
  process.stdin.on("data", (d) => term.write(d.toString()));
}

broadcast({ kind: "event", ev: { ts: Date.now(), type: "start", summary: "開始", detail: `${cmd} ${args.join(" ")}` } });

term.onData((data) => {
  const clean = redact(data);
  const evs = extractEvents(clean);

  // raw は “マスク後” を送る（MVP）
  broadcast({ kind: "raw", data: clean });

  for (const ev of evs) {
    broadcast({ kind: "event", ev });
    if (ev.type === "error" || shouldEmitNow()) {
      broadcast({ kind: "commentary", ts: ev.ts, text: comment(ev, currentStyle), ev });
    }
  }
});

term.onExit(({ exitCode }) => {
  const ev: Event = { ts: Date.now(), type: "done", summary: `終了 code=${exitCode}` };
  broadcast({ kind: "event", ev });
  broadcast({ kind: "commentary", ts: ev.ts, text: comment(ev, currentStyle), ev });
});

server.listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`);
});
