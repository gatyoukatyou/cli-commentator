#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(`[verify-updater] ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    config: "apps/desktop/src-tauri/tauri.conf.json",
    requirePrivateKey: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--config") {
      const next = argv[i + 1];
      if (!next) fail("--config requires a value");
      args.config = next;
      i += 1;
      continue;
    }

    if (value === "--require-private-key") {
      args.requirePrivateKey = true;
      continue;
    }

    if (value === "--help" || value === "-h") {
      console.log("Usage: node scripts/verify-updater-config.mjs [--config <path>] [--require-private-key]");
      process.exit(0);
    }

    fail(`Unknown argument: ${value}`);
  }

  return args;
}

function decodeBase64ToUtf8(input, label) {
  if (typeof input !== "string" || input.trim() === "") {
    fail(`${label} is empty`);
  }
  try {
    return Buffer.from(input, "base64").toString("utf8");
  } catch (error) {
    fail(`${label} is not valid base64: ${String(error)}`);
  }
}

function extractKeyIdFromBinaryLine(encodedLine, label) {
  if (typeof encodedLine !== "string" || encodedLine.trim() === "") {
    fail(`${label} line is empty`);
  }

  let decoded;
  try {
    decoded = Buffer.from(encodedLine, "base64");
  } catch (error) {
    fail(`${label} line is not valid base64: ${String(error)}`);
  }

  if (decoded.length < 10) {
    fail(`${label} line is too short (${decoded.length} bytes)`);
  }

  return Buffer.from(decoded.subarray(2, 10)).reverse().toString("hex").toUpperCase();
}

function parseUpdaterPubkey(pubkeyBase64) {
  const decoded = decodeBase64ToUtf8(pubkeyBase64, "plugins.updater.pubkey");
  const lines = decoded
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    fail("plugins.updater.pubkey must decode to at least 2 lines");
  }

  const commentLine = lines[0];
  const bodyLine = lines[1];
  const match = commentLine.match(/minisign public key:\s*([0-9A-Fa-f]{16})$/);

  if (!match) {
    fail("plugins.updater.pubkey comment line must contain minisign public key id");
  }

  const keyIdFromComment = match[1].toUpperCase();
  const keyIdFromBody = extractKeyIdFromBinaryLine(bodyLine, "updater pubkey");

  if (keyIdFromComment !== keyIdFromBody) {
    fail(
      `updater pubkey key id mismatch (comment=${keyIdFromComment}, body=${keyIdFromBody}).`
    );
  }

  return {
    keyId: keyIdFromComment,
  };
}

function extractPublicSignatureBase64(output) {
  const match = output.match(/Public signature:\s*([A-Za-z0-9+/=]+)/m);
  if (!match) {
    fail("Could not find `Public signature` in tauri signer output");
  }
  return match[1];
}

function extractSignatureKeyId(publicSignatureBase64) {
  const decoded = decodeBase64ToUtf8(publicSignatureBase64, "public signature");
  const lines = decoded
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    fail("public signature must decode to at least 2 lines");
  }

  return extractKeyIdFromBinaryLine(lines[1], "signature");
}

function runSignerSmoke(repoRoot, privateKey, privateKeyPassword) {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "cli-commentator-updater-"));
  const payloadPath = path.join(tmpDir, "updater-key-check.txt");
  writeFileSync(payloadPath, "cli-commentator updater key check\n", "utf8");

  const args = [
    "-C",
    "apps/desktop",
    "tauri",
    "signer",
    "sign",
    "-k",
    privateKey,
  ];

  if (privateKeyPassword) {
    args.push("-p", privateKeyPassword);
  }

  args.push(payloadPath);

  const result = spawnSync("pnpm", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
  });

  const combinedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  if (result.status !== 0) {
    rmSync(tmpDir, { recursive: true, force: true });
    fail(`tauri signer sign failed.\n${combinedOutput}`);
  }

  rmSync(tmpDir, { recursive: true, force: true });
  return extractSignatureKeyId(extractPublicSignatureBase64(combinedOutput));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const configPath = path.resolve(repoRoot, args.config);

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    fail(`Failed to read config at ${configPath}: ${String(error)}`);
  }

  const updater = config?.plugins?.updater;
  if (!updater || typeof updater !== "object") {
    fail("plugins.updater is missing in tauri.conf.json");
  }

  const pubkey = updater.pubkey;
  const { keyId: updaterKeyId } = parseUpdaterPubkey(pubkey);
  console.log(`[verify-updater] updater pubkey key id: ${updaterKeyId}`);

  const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY;
  const privateKeyPassword = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "";

  if (!privateKey) {
    if (args.requirePrivateKey) {
      fail("TAURI_SIGNING_PRIVATE_KEY is required but not set");
    }
    console.log("[verify-updater] TAURI_SIGNING_PRIVATE_KEY is not set; skipped private key pairing check.");
    console.log("[verify-updater] OK (config-only validation)");
    return;
  }

  const signatureKeyId = runSignerSmoke(repoRoot, privateKey, privateKeyPassword);
  console.log(`[verify-updater] signing private key id (from signature): ${signatureKeyId}`);

  if (signatureKeyId !== updaterKeyId) {
    fail(
      `Configured updater pubkey (${updaterKeyId}) does not match signing private key (${signatureKeyId}).`
    );
  }

  console.log("[verify-updater] OK (pubkey + private key pairing validated)");
}

main();
