#!/usr/bin/env node

import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "gatyoukatyou/cli-commentator";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function fail(message) {
  console.error(`[verify-internal-release] ERROR: ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[verify-internal-release] ${message}`);
}

function normalized(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
  };

  for (const value of argv) {
    if (value === "--") {
      continue;
    }
    if (value === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (value === "--help" || value === "-h") {
      console.log(
        [
          "Usage: node scripts/verify-internal-release-readiness.mjs [--dry-run]",
          "",
          "Runs the unsigned-internal release readiness checklist used in runbook section 1-1.",
          "--dry-run prints planned commands without executing them.",
        ].join("\n")
      );
      process.exit(0);
    }
    fail(`Unknown argument: ${value}`);
  }

  return args;
}

function preflightGuard() {
  if (!existsSync(path.join(repoRoot, "pnpm-workspace.yaml"))) {
    fail("pnpm-workspace.yaml was not found. Run from repository root.");
  }

  try {
    const remoteOutput = execSync("git remote -v", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!remoteOutput.includes("gatyoukatyou/cli-commentator")) {
      fail("Repository remote check failed (not cli-commentator).");
    }
  } catch (error) {
    fail(`Failed to read git remotes: ${String(error)}`);
  }
}

function resolveReleaseToken() {
  const envToken = normalized(process.env.GH_RELEASE_TOKEN);
  if (envToken) {
    return { value: envToken, source: "GH_RELEASE_TOKEN" };
  }

  const ghAuthToken = spawnSync("gh", ["auth", "token"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (ghAuthToken.status === 0) {
    const token = normalized(ghAuthToken.stdout);
    if (token) {
      return { value: token, source: "gh auth token" };
    }
  }

  return null;
}

function commandText(command, args) {
  return [command, ...args].join(" ");
}

function runTask(task, options) {
  const { title, command, args, env } = task;
  log(`START ${title}`);
  log(`CMD   ${commandText(command, args)}`);
  if (options.dryRun) {
    log(`SKIP  dry-run`);
    return;
  }

  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
    },
  });

  if (result.status !== 0) {
    fail(`${title} failed with exit code ${String(result.status)}`);
  }

  log(`PASS  ${title}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  preflightGuard();

  const token = resolveReleaseToken();
  if (!token) {
    fail(
      "No release token found. Set GH_RELEASE_TOKEN or run `gh auth login` first."
    );
  }
  log(`Release token source: ${token.source}`);

  const tasks = [
    {
      title: "Updater verification",
      command: "pnpm",
      args: ["verify:updater"],
    },
    {
      title: "Release token write preflight",
      command: "pnpm",
      args: ["verify:release-token", "--repo", REPO],
      env: { GH_RELEASE_TOKEN: token.value },
    },
    {
      title: "Apple signing detect",
      command: "pnpm",
      args: ["verify:apple-signing:detect"],
    },
    {
      title: "Web lint",
      command: "pnpm",
      args: ["-C", "apps/web", "lint"],
    },
    {
      title: "Web build",
      command: "pnpm",
      args: ["-C", "apps/web", "build"],
    },
    {
      title: "Server tests (no PTY)",
      command: "pnpm",
      args: ["-C", "apps/server", "test"],
      env: { CLI_COMMENTATOR_FORCE_NO_PTY: "1" },
    },
    {
      title: "Prepare desktop sidecar",
      command: "pnpm",
      args: ["prepare:desktop-sidecar"],
    },
    {
      title: "Desktop app build",
      command: "pnpm",
      args: [
        "-C",
        "apps/desktop",
        "tauri:build",
        "--bundles",
        "app",
        "--config",
        '{"bundle":{"createUpdaterArtifacts":false}}',
      ],
    },
    {
      title: "Desktop distribution smoke",
      command: "pnpm",
      args: ["smoke:desktop-distribution"],
    },
  ];

  for (const task of tasks) {
    runTask(task, args);
  }

  log(args.dryRun ? "DRY-RUN COMPLETE" : "ALL CHECKS PASSED");
}

main();
