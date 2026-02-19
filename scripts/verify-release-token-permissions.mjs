#!/usr/bin/env node

import { appendFileSync } from "node:fs";

function fail(message) {
  console.error(`[verify-release-token] ERROR: ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(`[verify-release-token] ${message}`);
}

function githubAnnotation(level, message) {
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::${level}::${message}`);
  }
}

function normalized(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseArgs(argv) {
  const args = {
    mode: "detect",
    repo: normalized(process.env.GITHUB_REPOSITORY),
    writeGithubOutput: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];

    if (value === "--mode") {
      const next = argv[i + 1];
      if (!next) {
        fail("--mode requires a value");
      }
      if (next !== "detect" && next !== "require-write") {
        fail(`--mode must be one of: detect, require-write (received: ${next})`);
      }
      args.mode = next;
      i += 1;
      continue;
    }

    if (value === "--repo") {
      const next = argv[i + 1];
      if (!next) {
        fail("--repo requires a value");
      }
      args.repo = normalized(next);
      i += 1;
      continue;
    }

    if (value === "--write-github-output") {
      args.writeGithubOutput = true;
      continue;
    }

    if (value === "--help" || value === "-h") {
      console.log(
        [
          "Usage: node scripts/verify-release-token-permissions.mjs [--mode <detect|require-write>] [--repo <owner/repo>] [--write-github-output]",
          "",
          "Modes:",
          "  detect         Probe release-write capability and report result (always exit 0).",
          "  require-write  Exit 1 unless release-write capability is confirmed.",
        ].join("\n")
      );
      process.exit(0);
    }

    fail(`Unknown argument: ${value}`);
  }

  return args;
}

function selectToken(env) {
  const ghReleaseToken = normalized(env.GH_RELEASE_TOKEN);
  if (ghReleaseToken) {
    return {
      available: true,
      source: "gh_release_token",
      value: ghReleaseToken,
    };
  }

  const githubToken = normalized(env.GITHUB_TOKEN);
  if (githubToken) {
    return {
      available: true,
      source: "github_token",
      value: githubToken,
    };
  }

  return {
    available: false,
    source: "none",
    value: "",
  };
}

function parseApiErrorMessage(payload) {
  if (!payload || typeof payload !== "object") {
    return "Unknown GitHub API error";
  }
  if (typeof payload.message === "string" && payload.message.trim() !== "") {
    return payload.message.trim();
  }
  return "Unknown GitHub API error";
}

async function probeReleaseWriteCapability(repo, token) {
  const endpoint = `https://api.github.com/repos/${repo}`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "cli-commentator-release-token-probe",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const requestId = normalized(response.headers.get("x-github-request-id"));
  const oauthScopes = normalized(response.headers.get("x-oauth-scopes"));
  const details = [];
  if (oauthScopes) {
    details.push(`x-oauth-scopes=${oauthScopes}`);
  }
  if (requestId) {
    details.push(`request_id=${requestId}`);
  }

  if (!response.ok) {
    const apiMessage = parseApiErrorMessage(payload);
    return {
      writeCapable: false,
      probeStatus: "api_error",
      message: `GitHub API probe failed (${response.status}): ${apiMessage}`,
      details,
    };
  }

  const permissions =
    payload && typeof payload === "object" && payload.permissions && typeof payload.permissions === "object"
      ? payload.permissions
      : null;

  if (!permissions) {
    return {
      writeCapable: false,
      probeStatus: "permission_unknown",
      message: "GitHub API response did not include `permissions`; cannot confirm write capability.",
      details,
    };
  }

  const canPush = permissions.push === true;
  const canMaintain = permissions.maintain === true;
  const canAdmin = permissions.admin === true;
  const writeCapable = canPush || canMaintain || canAdmin;

  if (!writeCapable) {
    return {
      writeCapable: false,
      probeStatus: "permission_read_only",
      message: "Token does not have repository write permission (`permissions.push` is false).",
      details,
    };
  }

  return {
    writeCapable: true,
    probeStatus: "permission_write",
    message: "Token has repository write permission.",
    details,
  };
}

function writeGithubOutput(state) {
  const outputPath = normalized(process.env.GITHUB_OUTPUT);
  if (!outputPath) {
    fail("--write-github-output requested but GITHUB_OUTPUT is not set");
  }

  const lines = [
    `token_available=${state.tokenAvailable ? "true" : "false"}`,
    `token_source=${state.tokenSource}`,
    `write_capable=${state.writeCapable ? "true" : "false"}`,
    `probe_status=${state.probeStatus}`,
  ];

  appendFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = selectToken(process.env);

  const state = {
    tokenAvailable: token.available,
    tokenSource: token.source,
    writeCapable: false,
    probeStatus: "not_probed",
  };

  if (!token.available) {
    const message = "No token available (`GH_RELEASE_TOKEN` and `GITHUB_TOKEN` are both missing).";
    state.probeStatus = "no_token";
    githubAnnotation("warning", message);
    info(message);
    if (args.writeGithubOutput) {
      writeGithubOutput(state);
    }
    if (args.mode === "require-write") {
      fail(message);
    }
    return;
  }

  if (!args.repo) {
    const message = "Repository is not set. Pass `--repo owner/repo` or set `GITHUB_REPOSITORY`.";
    state.probeStatus = "missing_repo";
    githubAnnotation("warning", message);
    info(message);
    if (args.writeGithubOutput) {
      writeGithubOutput(state);
    }
    if (args.mode === "require-write") {
      fail(message);
    }
    return;
  }

  info(`Token source: ${state.tokenSource}`);
  info(`Probing repository permissions for ${args.repo}`);

  let probe;
  try {
    probe = await probeReleaseWriteCapability(args.repo, token.value);
  } catch (error) {
    const message = `Release permission probe failed: ${error instanceof Error ? error.message : String(error)}`;
    state.probeStatus = "probe_exception";
    githubAnnotation("warning", message);
    info(message);
    if (args.writeGithubOutput) {
      writeGithubOutput(state);
    }
    if (args.mode === "require-write") {
      fail(message);
    }
    return;
  }

  state.writeCapable = probe.writeCapable;
  state.probeStatus = probe.probeStatus;

  for (const detail of probe.details) {
    info(detail);
  }

  if (probe.writeCapable) {
    githubAnnotation("notice", `Release permission preflight passed (${state.tokenSource}).`);
    info(probe.message);
  } else {
    githubAnnotation("warning", `Release permission preflight did not confirm write capability: ${probe.message}`);
    info(probe.message);
  }

  if (args.writeGithubOutput) {
    writeGithubOutput(state);
  }

  if (args.mode === "require-write" && !probe.writeCapable) {
    fail(probe.message);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
});
