#!/usr/bin/env node

import { appendFileSync } from "node:fs";

const REQUIRED_SECRETS = [
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "KEYCHAIN_PASSWORD",
  "APPLE_ID",
  "APPLE_PASSWORD",
  "APPLE_TEAM_ID",
];

function fail(message) {
  console.error(`[verify-apple-signing] ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    mode: "detect",
    writeGithubOutput: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];

    if (value === "--mode") {
      const next = argv[i + 1];
      if (!next) {
        fail("--mode requires a value");
      }
      if (next !== "detect" && next !== "require") {
        fail(`--mode must be one of: detect, require (received: ${next})`);
      }
      args.mode = next;
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
          "Usage: node scripts/verify-apple-signing-secrets.mjs [--mode <detect|require>] [--write-github-output]",
          "",
          "Modes:",
          "  detect   Missing secrets are reported and exit code stays 0.",
          "  require  Missing secrets are treated as errors (exit 1).",
        ].join("\n")
      );
      process.exit(0);
    }

    fail(`Unknown argument: ${value}`);
  }

  return args;
}

function logInfo(message) {
  console.log(`[verify-apple-signing] ${message}`);
}

function logGithub(level, message) {
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::${level}::${message}`);
  }
}

function normalized(value) {
  return typeof value === "string" ? value.trim() : "";
}

function strictBase64Decode(value, label) {
  const compact = value.replace(/\s+/g, "");
  if (compact === "") {
    fail(`${label} is empty`);
  }
  if (compact.length % 4 !== 0) {
    fail(`${label} is not valid base64 (length must be a multiple of 4)`);
  }
  if (/[^A-Za-z0-9+/=]/.test(compact)) {
    fail(`${label} contains non-base64 characters`);
  }

  const decoded = Buffer.from(compact, "base64");
  const roundTrip = decoded.toString("base64").replace(/=+$/u, "");
  const inputNoPadding = compact.replace(/=+$/u, "");
  if (roundTrip !== inputNoPadding) {
    fail(`${label} failed strict base64 round-trip validation`);
  }
  return decoded;
}

function validateAllSecrets(env) {
  const certBytes = strictBase64Decode(normalized(env.APPLE_CERTIFICATE), "APPLE_CERTIFICATE");
  if (certBytes.length < 512) {
    fail(`APPLE_CERTIFICATE decoded payload is unexpectedly small (${certBytes.length} bytes)`);
  }
  if (certBytes[0] !== 0x30) {
    fail("APPLE_CERTIFICATE does not look like DER-encoded PKCS#12 data");
  }

  const appleId = normalized(env.APPLE_ID);
  if (!appleId.includes("@")) {
    fail("APPLE_ID must be an email address");
  }

  const teamId = normalized(env.APPLE_TEAM_ID);
  if (!/^[A-Z0-9]{10}$/u.test(teamId)) {
    fail("APPLE_TEAM_ID must be a 10-character uppercase alphanumeric value");
  }

  logInfo(`APPLE_CERTIFICATE decoded size: ${certBytes.length} bytes`);
}

function writeGithubOutput(enabled, missingSecrets) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    fail("--write-github-output requested but GITHUB_OUTPUT is not set");
  }

  const lines = [`enabled=${enabled ? "true" : "false"}`, `missing=${missingSecrets.join(" ")}`];
  appendFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const missing = REQUIRED_SECRETS.filter((key) => normalized(process.env[key]) === "");

  if (missing.length > 0) {
    const message = `Apple signing/notarization disabled; missing secrets: ${missing.join(" ")}`;

    if (args.writeGithubOutput) {
      writeGithubOutput(false, missing);
    }

    if (args.mode === "require") {
      logGithub("error", message);
      fail(message);
    }

    logGithub("warning", message);
    logInfo(message);
    return;
  }

  validateAllSecrets(process.env);

  if (args.writeGithubOutput) {
    writeGithubOutput(true, []);
  }

  logGithub("notice", "All required Apple signing/notarization secrets are present.");
  logInfo("All required Apple signing/notarization secrets are present and valid.");
}

main();
