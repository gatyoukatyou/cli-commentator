#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SKIP_TOKEN = "[skip-doc-sync-check]";

export const RULES = [
  {
    id: "llm-adapter-doc-sync",
    description: "LLM implementation changes should update LLM adapter docs",
    triggers: [
      /^apps\/server\/src\/llm\//,
      /^apps\/server\/\.env\.example$/,
    ],
    requiredDocs: [
      "docs/LLM_ADAPTER.ja.md",
      "docs/docs-update-flow.ja.md",
      "docs/docs-update-flow.en.md",
    ],
  },
  {
    id: "desktop-distribution-doc-sync",
    description: "Desktop distribution/runtime changes should update operations docs",
    triggers: [
      /^apps\/desktop\//,
      /^scripts\/prepare-desktop-sidecar\.mjs$/,
      /^\.github\/workflows\/ci\.yml$/,
      /^\.github\/workflows\/release-desktop\.yml$/,
    ],
    ignoredFiles: [
      /^apps\/desktop\/src-tauri\/Cargo\.lock$/,
      /^apps\/desktop\/src-tauri\/gen\//,
    ],
    requiredDocs: [
      "docs/ROADMAP.ja.md",
      "docs/ROADMAP.en.md",
      "docs/getting-started.ja.md",
      "docs/getting-started.en.md",
      "docs/desktop-release.ja.md",
      "docs/desktop-release.en.md",
      "docs/release-runbook.ja.md",
      "docs/release-runbook.en.md",
      "docs/certificate-secrets.ja.md",
      "docs/certificate-secrets.en.md",
      "docs/docs-update-flow.ja.md",
      "docs/docs-update-flow.en.md",
    ],
  },
];

function run(command) {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function parseFileList(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function runFileList(command) {
  try {
    return parseFileList(run(command));
  } catch {
    return [];
  }
}

function parseArgs(argv) {
  const parsed = {
    baseRef: process.env.GITHUB_BASE_REF || "main",
    headRef: "HEAD",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-ref") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--base-ref requires a value");
      }
      parsed.baseRef = next;
      i += 1;
      continue;
    }

    if (arg === "--head-ref") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--head-ref requires a value");
      }
      parsed.headRef = next;
      i += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-doc-sync.mjs [--base-ref <branch>] [--head-ref <ref>]");
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function readPullRequestBody() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) {
    return "";
  }

  try {
    const payload = JSON.parse(readFileSync(eventPath, "utf8"));
    return String(payload?.pull_request?.body ?? "");
  } catch {
    return "";
  }
}

function getChangedFiles(baseRef, headRef) {
  const ranges = [`origin/${baseRef}...${headRef}`, `${baseRef}...${headRef}`];
  let lastError = null;
  let committedFiles = [];
  let resolvedRange = false;

  for (const range of ranges) {
    try {
      const output = run(`git diff --name-only --diff-filter=ACMRTUXB ${range}`);
      committedFiles = parseFileList(output);
      resolvedRange = true;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!resolvedRange) {
    throw new Error(
      `Could not resolve git diff range for base '${baseRef}' and head '${headRef}'. ${String(lastError)}`
    );
  }

  const localFiles = [
    ...runFileList("git diff --name-only --diff-filter=ACMRTUXB"),
    ...runFileList("git diff --cached --name-only --diff-filter=ACMRTUXB"),
    ...runFileList("git ls-files --others --exclude-standard"),
  ];

  return [...new Set([...committedFiles, ...localFiles])].sort();
}

export function findViolations(changedFiles, rules = RULES) {
  const violations = [];

  for (const rule of rules) {
    const matchedFiles = changedFiles.filter((file) =>
      rule.triggers.some((pattern) => pattern.test(file)) &&
      !rule.ignoredFiles?.some((pattern) => pattern.test(file))
    );

    if (matchedFiles.length === 0) {
      continue;
    }

    const hasRequiredDocChange = changedFiles.some((file) =>
      rule.requiredDocs.includes(file)
    );

    if (!hasRequiredDocChange) {
      violations.push({
        ruleId: rule.id,
        description: rule.description,
        matchedFiles,
        requiredDocs: rule.requiredDocs,
      });
    }
  }

  return violations;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const changedFiles = getChangedFiles(args.baseRef, args.headRef);

  console.log(`[doc-sync] Comparing ${args.baseRef}...${args.headRef}`);
  console.log(`[doc-sync] Changed files: ${changedFiles.length}`);

  if (changedFiles.length === 0) {
    console.log("[doc-sync] No changed files. PASS");
    return;
  }

  const prBody = readPullRequestBody();
  if (prBody.includes(SKIP_TOKEN)) {
    console.log(`[doc-sync] Skip token '${SKIP_TOKEN}' found in PR body. PASS`);
    return;
  }

  const violations = findViolations(changedFiles);

  if (violations.length === 0) {
    console.log("[doc-sync] All triggered rules satisfied. PASS");
    return;
  }

  console.error("[doc-sync] Documentation drift guard failed.");
  for (const violation of violations) {
    console.error("");
    console.error(`Rule: ${violation.ruleId}`);
    console.error(`Reason: ${violation.description}`);
    console.error(`Matched files: ${violation.matchedFiles.join(", ")}`);
    console.error(`Required docs (update at least one): ${violation.requiredDocs.join(", ")}`);
  }

  console.error("");
  console.error("How to fix:");
  console.error("1) Update one of the required docs in this PR.");
  console.error(`2) If intentionally skipped, add '${SKIP_TOKEN}' to the PR body with a reason.`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
