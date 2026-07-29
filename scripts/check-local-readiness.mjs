#!/usr/bin/env node

/**
 * ローカル検証の入口（local readiness check）。
 *
 * clean checkout から「自分のMacでこのリポジトリが動く状態か」を、
 * 1コマンドで順に確認する。CIの test / desktop_check ジョブが見ている範囲のうち、
 * ローカルで意味があるものだけを実行する。
 *
 * 使い方:
 *   pnpm check:local-readiness
 *   pnpm check:local-readiness --skip-desktop
 *   pnpm check:local-readiness --list
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

/** CIの `test` ジョブが使うNodeメジャーバージョン。 */
export const EXPECTED_NODE_MAJOR = 20;

export const STATUS = {
  pass: "PASS",
  fail: "FAIL",
  skip: "SKIP",
};

/**
 * 実行するステップの定義。
 *
 * hint はそのステップが落ちたときに、非エンジニアでも次の一手が分かる日本語の案内。
 */
export const STEPS = [
  {
    id: "desktop-sidecar",
    title: "デスクトップ用sidecarの準備",
    command: "pnpm",
    args: ["ensure:desktop-sidecar"],
    group: "desktop",
    hint: "`sidecar_node_not_portable` が出た場合、使用中のNodeがHomebrew版で自己完結していない。nodejs.org版などに切り替えてから再実行する。",
  },
  {
    id: "web-lint",
    title: "Web UI の lint",
    command: "pnpm",
    args: ["-C", "apps/web", "lint"],
    group: "core",
    hint: "`pnpm -C apps/web lint` の出力を見て、指摘されたファイルを直す。",
  },
  {
    id: "web-build",
    title: "Web UI のビルド",
    command: "pnpm",
    args: ["-C", "apps/web", "build"],
    group: "core",
    hint: "型エラーが出ていることが多い。`pnpm -C apps/web build` の先頭のエラーから直す。",
  },
  {
    id: "server-test",
    title: "サーバーのテスト",
    // apps/server の `test` スクリプトは素の `vitest` で、端末から実行すると
    // watch モードに入って終わらない。入口スクリプトからは必ず `run` を使う。
    command: "pnpm",
    args: ["-C", "apps/server", "exec", "vitest", "run"],
    group: "core",
    hint: "失敗したテスト名で `apps/server/src` を検索し、直前の変更と突き合わせる。",
  },
  {
    id: "server-typecheck",
    title: "サーバーの型チェック",
    command: "pnpm",
    args: ["-C", "apps/server", "exec", "tsc", "--noEmit"],
    group: "core",
    hint: "`tsc --noEmit` の1件目のエラーから直す。テストが通っていても型が壊れていることがある。",
  },
  {
    id: "desktop-sidecar-runtime",
    title: "sidecarランタイムの検証",
    command: "pnpm",
    args: ["test:desktop-sidecar-runtime"],
    group: "desktop",
    hint: "同梱Nodeが自己完結型かを見ている。Homebrew版Nodeが混ざると落ちる。",
  },
  {
    id: "desktop-cargo-test",
    title: "デスクトップ（Rust）のテスト",
    command: "cargo",
    args: ["test", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml"],
    group: "desktop",
    requires: "cargo",
    hint: "Rustツールチェーンが必要。未導入なら https://rustup.rs から入れる。",
  },
];

export function parseArgs(argv) {
  const options = { list: false, skipDesktop: false, help: false };

  for (const arg of argv) {
    if (arg === "--list") options.list = true;
    else if (arg === "--skip-desktop") options.skipDesktop = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else return { ...options, unknown: arg };
  }

  return options;
}

export function selectSteps(steps, options) {
  return options.skipDesktop
    ? steps.filter((step) => step.group !== "desktop")
    : steps;
}

/**
 * 実行前の前提確認。ここが崩れているとステップの失敗理由が読めなくなるため、
 * 致命的なものだけ fatal にして先に止める。
 */
export function preflight({
  nodeVersion = process.version,
  hasNodeModules = fs.existsSync(path.join(repoRoot, "node_modules")),
  hasPnpm = commandExists("pnpm"),
} = {}) {
  const notes = [];
  let fatal = null;

  if (!hasPnpm) {
    fatal = "pnpm が見つからない。`corepack enable pnpm` を実行する。";
  } else if (!hasNodeModules) {
    fatal = "依存関係が未インストール。先に `pnpm install` を実行する。";
  }

  const major = Number.parseInt(String(nodeVersion).replace(/^v/, ""), 10);
  if (Number.isFinite(major) && major !== EXPECTED_NODE_MAJOR) {
    notes.push(
      `Node ${nodeVersion} で実行中。CIは Node ${EXPECTED_NODE_MAJOR} を使うため、ここで通ってもCIで差が出ることがある。`
    );
  }

  return { fatal, notes };
}

export function commandExists(command) {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [
    command,
  ]);
  return probe.status === 0;
}

export function summarize(results) {
  return {
    pass: results.filter((r) => r.status === STATUS.pass).length,
    fail: results.filter((r) => r.status === STATUS.fail).length,
    skip: results.filter((r) => r.status === STATUS.skip).length,
    ok: results.every((r) => r.status !== STATUS.fail),
  };
}

export function formatCommand(step) {
  return [step.command, ...step.args].join(" ");
}

export function formatSummary(results) {
  const lines = results.map(
    (result) => `  ${result.status.padEnd(4)} ${result.title}`
  );

  const failed = results.filter((r) => r.status === STATUS.fail);
  if (failed.length > 0) {
    lines.push("");
    lines.push("直し方の入口:");
    for (const result of failed) {
      lines.push(`  - ${result.title}: ${result.hint}`);
      lines.push(`    再実行: ${formatCommand(result)}`);
    }
  }

  return lines.join("\n");
}

function log(message) {
  console.log(`[readiness] ${message}`);
}

function runStep(step) {
  if (step.requires && !commandExists(step.requires)) {
    log(`SKIP ${step.title}（${step.requires} が見つからない）`);
    return { ...step, status: STATUS.skip };
  }

  log(`RUN  ${step.title} — ${formatCommand(step)}`);
  const run = spawnSync(step.command, step.args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  const status = run.status === 0 ? STATUS.pass : STATUS.fail;
  log(`${status} ${step.title}`);
  return { ...step, status };
}

function main(argv) {
  const options = parseArgs(argv);

  if (options.unknown) {
    console.error(`[readiness] 不明なオプション: ${options.unknown}`);
    return 2;
  }

  if (options.help) {
    console.log(
      [
        "使い方: pnpm check:local-readiness [--skip-desktop] [--list]",
        "",
        "  --skip-desktop  Tauri/Rust関連のステップを飛ばす（Web/サーバーだけ確認する）",
        "  --list          実行するコマンドを表示するだけで実行しない",
      ].join("\n")
    );
    return 0;
  }

  const steps = selectSteps(STEPS, options);

  if (options.list) {
    for (const step of steps) {
      console.log(`${step.id}\t${formatCommand(step)}`);
    }
    return 0;
  }

  const { fatal, notes } = preflight();
  for (const note of notes) {
    log(`NOTE ${note}`);
  }
  if (fatal) {
    console.error(`[readiness] ${fatal}`);
    return 1;
  }

  // 1件落ちても残りを流す。「何がどれだけ壊れているか」を一度で把握するため。
  const results = steps.map(runStep);
  const totals = summarize(results);

  console.log("");
  log("結果");
  console.log(formatSummary(results));
  console.log("");
  log(
    `PASS ${totals.pass} / FAIL ${totals.fail} / SKIP ${totals.skip} — ${
      totals.ok ? "ローカル検証OK" : "未解決の失敗あり"
    }`
  );

  return totals.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
