#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as plist from "plist";
import * as tar from "tar";

const EXPECTED_BUNDLE_IDENTIFIER = "com.cli-commentator.desktop";
const EXPECTED_BUNDLE_EXECUTABLE = "cli-commentator-desktop";
export const EXPECTED_GITHUB_REPOSITORY = "gatyoukatyou/cli-commentator";
const GITHUB_DOWNLOAD_HOST = "github.com";
const GITHUB_API_HOST = "api.github.com";
const EXPECTED_PLATFORM_ASSETS = {
  "darwin-aarch64": "aarch64.app.tar.gz",
  "darwin-aarch64-app": "aarch64.app.tar.gz",
  "darwin-x86_64": "x64.app.tar.gz",
  "darwin-x86_64-app": "x64.app.tar.gz",
};

const REQUIREMENTS = {
  app: {
    label: ".app bundle",
    match: (filePath, stats) => stats.isDirectory() && filePath.endsWith(".app"),
  },
  dmg: {
    label: ".dmg installer",
    match: (filePath, stats) => stats.isFile() && filePath.endsWith(".dmg"),
  },
  "app-tar-gz": {
    label: ".app.tar.gz updater archive",
    match: (filePath, stats) => stats.isFile() && filePath.endsWith(".app.tar.gz"),
  },
  sig: {
    label: ".sig updater signature",
    match: (filePath, stats) => stats.isFile() && filePath.endsWith(".sig"),
  },
};

export class VerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationError";
  }
}

function fail(message) {
  throw new VerificationError(message);
}

function splitRepository(repository) {
  const [owner, name, ...rest] = String(repository).split("/");
  if (!owner || !name || rest.length > 0) {
    throw new Error("Expected GitHub repository in owner/name form");
  }
  return { owner, name };
}

function decodeUrlSegment(value, label) {
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    fail(`GitHub asset URL has an invalid encoded ${label}`);
  }
  if (!decoded || decoded.includes("/") || decoded.includes("\\")) {
    fail(`GitHub asset URL has an invalid ${label}`);
  }
  return decoded;
}

function assertExpectedRepository(owner, name, expectedRepository) {
  const expected = splitRepository(expectedRepository);
  if (owner !== expected.owner || name !== expected.name) {
    fail(`GitHub asset URL repository must be ${expectedRepository}`);
  }
}

/**
 * Parse the two URL shapes emitted by the desktop release process.
 *
 * API asset URLs intentionally return an asset ID here. The caller must use
 * resolveAssetReference() to resolve that ID through authenticated metadata
 * before treating it as a local filename.
 */
export function parseAssetUrl(urlValue, { expectedRepository = EXPECTED_GITHUB_REPOSITORY } = {}) {
  if (typeof urlValue !== "string" || urlValue.trim().length === 0) {
    fail("latest.json platform URL must be a non-empty string");
  }

  let parsed;
  try {
    parsed = new URL(urlValue);
  } catch {
    fail("latest.json platform URL is not a valid URL");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    fail("GitHub asset URL must use HTTPS without credentials, query, or fragment");
  }

  const segments = parsed.pathname.split("/");
  if (parsed.hostname === GITHUB_DOWNLOAD_HOST) {
    if (segments.length !== 7 || segments[3] !== "releases" || segments[4] !== "download") {
      fail("GitHub download URL has an unsupported path");
    }

    const owner = decodeUrlSegment(segments[1], "owner");
    const repository = decodeUrlSegment(segments[2], "repository");
    assertExpectedRepository(owner, repository, expectedRepository);
    const assetName = decodeUrlSegment(segments[6], "asset name");
    if (assetName === "." || assetName === "..") {
      fail("GitHub download URL has an invalid asset name");
    }

    return {
      kind: "download",
      url: parsed.toString(),
      owner,
      repository,
      tag: decodeUrlSegment(segments[5], "tag"),
      assetName,
    };
  }

  if (parsed.hostname === GITHUB_API_HOST) {
    if (segments.length !== 7 || segments[1] !== "repos" || segments[4] !== "releases" || segments[5] !== "assets") {
      fail("GitHub asset API URL has an unsupported path");
    }

    const owner = decodeUrlSegment(segments[2], "owner");
    const repository = decodeUrlSegment(segments[3], "repository");
    assertExpectedRepository(owner, repository, expectedRepository);
    const assetId = segments[6];
    if (!/^[1-9][0-9]*$/u.test(assetId)) {
      fail("GitHub asset API URL must end with a numeric asset ID");
    }

    return {
      kind: "github-api",
      url: parsed.toString(),
      owner,
      repository,
      assetId,
    };
  }

  fail(`Unsupported GitHub asset URL host: ${parsed.hostname}`);
}

export function redactSecrets(message, secrets = []) {
  const candidates = [
    ...secrets,
    process.env.GH_RELEASE_TOKEN,
    process.env.GITHUB_TOKEN,
  ].filter((value) => typeof value === "string" && value.length > 0);
  let redacted = String(message);
  for (const secret of candidates) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

export function resolveGithubToken({ env = process.env, execFileSyncImpl = execFileSync } = {}) {
  for (const variable of ["GH_RELEASE_TOKEN", "GITHUB_TOKEN"]) {
    const value = env?.[variable];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }

  try {
    const value = execFileSyncImpl("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

function validateMetadataAssetName(name) {
  if (typeof name !== "string" || name.trim().length === 0 || name.includes("/") || name.includes("\\")) {
    fail("GitHub asset metadata returned an invalid asset name");
  }
  if (name === "." || name === "..") fail("GitHub asset metadata returned an invalid asset name");
  return name;
}

export async function resolveAssetReference(
  urlValue,
  {
    expectedRepository = EXPECTED_GITHUB_REPOSITORY,
    fetchImpl = globalThis.fetch,
    getToken = () => resolveGithubToken(),
  } = {}
) {
  const parsed = parseAssetUrl(urlValue, { expectedRepository });
  if (parsed.kind === "download") return parsed;

  if (typeof fetchImpl !== "function") {
    fail("GitHub asset metadata fetch is unavailable");
  }

  let token;
  try {
    token = await getToken();
  } catch {
    fail("GitHub asset metadata requires an authentication token");
  }
  if (typeof token !== "string" || token.trim().length === 0) {
    fail("GitHub asset metadata requires an authentication token");
  }

  let response;
  try {
    response = await fetchImpl(parsed.url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token.trim()}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch {
    fail(`GitHub asset metadata request failed for asset ${parsed.assetId}`);
  }

  if (!response?.ok) {
    const status = Number.isInteger(response?.status) ? ` (HTTP ${response.status})` : "";
    fail(`GitHub asset metadata request failed for asset ${parsed.assetId}${status}`);
  }

  let metadata;
  try {
    metadata = await response.json();
  } catch {
    fail(`GitHub asset metadata response was not valid JSON for asset ${parsed.assetId}`);
  }

  if (!metadata || String(metadata.id) !== parsed.assetId) {
    fail(`GitHub asset metadata ID did not match ${parsed.assetId}`);
  }
  if (metadata.state !== "uploaded") {
    fail(`GitHub asset ${parsed.assetId} is not uploaded`);
  }

  const assetName = validateMetadataAssetName(metadata.name);
  let browserReference;
  try {
    browserReference = parseAssetUrl(metadata.browser_download_url, { expectedRepository });
  } catch {
    fail(`GitHub asset metadata browser URL is invalid for asset ${parsed.assetId}`);
  }
  if (browserReference.kind !== "download" || browserReference.assetName !== assetName) {
    fail(`GitHub asset metadata name did not match its browser URL for asset ${parsed.assetId}`);
  }

  return {
    ...parsed,
    assetName,
    metadata,
  };
}

function parseArgs(argv) {
  const args = {
    bundleDir: null,
    requirements: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--require") {
      const next = argv[index + 1];
      if (!next) fail("--require needs one of: app, dmg, app-tar-gz, sig");
      if (!REQUIREMENTS[next]) fail(`Unknown artifact requirement: ${next}`);
      args.requirements.push(next);
      index += 1;
      continue;
    }
    if (value === "--help" || value === "-h") {
      console.log(
        [
          "Usage: node scripts/verify-desktop-bundle-artifacts.mjs <bundle-dir> [--require <kind>...]",
          "",
          "Kinds: app, dmg, app-tar-gz, sig",
        ].join("\n")
      );
      process.exit(0);
    }
    if (!args.bundleDir) {
      args.bundleDir = value;
      continue;
    }
    fail(`Unexpected argument: ${value}`);
  }

  if (!args.bundleDir) fail("Bundle directory is required");
  if (args.requirements.length === 0) args.requirements.push("app");
  return args;
}

function walk(rootDir) {
  const found = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !existsSync(current)) continue;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const stats = statSync(fullPath);
      found.push({ path: fullPath, stats });
      if (entry.isDirectory() && !entry.name.endsWith(".app")) {
        stack.push(fullPath);
      }
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

function directorySize(rootDir) {
  let total = 0;
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const stats = statSync(current);
    if (stats.isFile()) {
      total += stats.size;
      continue;
    }
    if (!stats.isDirectory()) continue;
    for (const entry of readdirSync(current)) {
      stack.push(path.join(current, entry));
    }
  }
  return total;
}

function artifactSize(entry) {
  return entry.stats.isDirectory() ? directorySize(entry.path) : entry.stats.size;
}

function normalizeTarPath(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function hasTarEntry(entries, predicate) {
  return entries.some((entry) => predicate(normalizeTarPath(entry)));
}

async function listTarEntries(archivePath) {
  const entries = [];
  await tar.t({
    file: archivePath,
    onentry(entry) {
      entries.push(normalizeTarPath(entry.path));
    },
  });
  return entries.sort((a, b) => a.localeCompare(b));
}

async function readTarEntry(archivePath, entryPath) {
  const chunks = [];
  let found = false;
  await tar.t({
    file: archivePath,
    onentry(entry) {
      if (normalizeTarPath(entry.path) !== entryPath) {
        entry.resume();
        return;
      }
      found = true;
      entry.on("data", (chunk) => chunks.push(chunk));
    },
  });
  if (!found) fail(`Missing archive entry: ${archivePath} -> ${entryPath}`);
  return Buffer.concat(chunks);
}

function parseLatestJson(bundleDir, entries) {
  const latestMatches = entries
    .filter((entry) => entry.stats.isFile() && path.basename(entry.path) === "latest.json")
    .map((entry) => entry.path);
  if (latestMatches.length === 0) return null;
  if (latestMatches.length > 1) fail(`Found multiple latest.json files: ${latestMatches.join(", ")}`);

  const latestPath = latestMatches[0];

  let latest;
  try {
    latest = JSON.parse(readFileSync(latestPath, "utf8"));
  } catch (error) {
    fail(`latest.json is not valid JSON: ${latestPath} (${error.message})`);
  }

  for (const key of ["version", "notes", "pub_date", "platforms"]) {
    if (!Object.hasOwn(latest, key)) fail(`latest.json missing required key: ${key}`);
  }
  if (typeof latest.version !== "string" || latest.version.trim().length === 0) {
    fail("latest.json version must be a non-empty string");
  }
  if (typeof latest.notes !== "string") fail("latest.json notes must be a string");
  if (Number.isNaN(Date.parse(latest.pub_date))) fail(`latest.json pub_date is not parseable: ${latest.pub_date}`);
  if (!latest.platforms || typeof latest.platforms !== "object" || Array.isArray(latest.platforms)) {
    fail("latest.json platforms must be an object");
  }

  return { path: latestPath, data: latest };
}

export async function validateLatestJson(latest, entries, options = {}) {
  if (!latest) return;

  const assetNames = new Set(
    entries.filter((entry) => entry.stats.isFile()).map((entry) => path.basename(entry.path))
  );
  const resolveReference = options.resolveAssetReference ?? ((url) =>
    resolveAssetReference(url, options)
  );

  for (const [platform, expectedAssetSuffix] of Object.entries(EXPECTED_PLATFORM_ASSETS)) {
    const platformEntry = latest.data.platforms[platform];
    if (!platformEntry) fail(`latest.json missing platform entry: ${platform}`);
    if (typeof platformEntry.url !== "string" || platformEntry.url.trim().length === 0) {
      fail(`latest.json ${platform}.url must be a non-empty string`);
    }
    if (typeof platformEntry.signature !== "string" || platformEntry.signature.trim().length === 0) {
      fail(`latest.json ${platform}.signature must be a non-empty string`);
    }

    let assetReference;
    try {
      assetReference = await resolveReference(platformEntry.url);
    } catch (error) {
      if (error instanceof VerificationError) {
        fail(`latest.json ${platform}.url: ${error.message}`);
      }
      fail(`latest.json ${platform}.url could not be resolved`);
    }

    const basename = assetReference.assetName;

    if (!basename.endsWith(expectedAssetSuffix)) {
      fail(`latest.json ${platform}.url points to unexpected asset: ${basename}`);
    }
    if (!assetNames.has(basename)) {
      fail(`latest.json ${platform}.url points to missing asset: ${basename}`);
    }
  }

  console.log(`[desktop-artifacts] latest.json: ${path.relative(process.cwd(), latest.path)} (${latest.data.version})`);
}

function validateInfoPlist(plistData, archivePath, latest) {
  if (plistData.CFBundleIdentifier !== EXPECTED_BUNDLE_IDENTIFIER) {
    fail(
      `${archivePath} Info.plist CFBundleIdentifier mismatch: expected ${EXPECTED_BUNDLE_IDENTIFIER}, got ${plistData.CFBundleIdentifier}`
    );
  }
  if (plistData.CFBundleExecutable !== EXPECTED_BUNDLE_EXECUTABLE) {
    fail(
      `${archivePath} Info.plist CFBundleExecutable mismatch: expected ${EXPECTED_BUNDLE_EXECUTABLE}, got ${plistData.CFBundleExecutable}`
    );
  }

  const bundleVersion = plistData.CFBundleShortVersionString;
  const expectedVersion = latest?.data.version;
  if (expectedVersion) {
    if (bundleVersion !== expectedVersion) {
      fail(`${archivePath} Info.plist version mismatch: latest.json=${expectedVersion}, Info.plist=${bundleVersion}`);
    }
    return;
  }

  if (typeof bundleVersion !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(bundleVersion)) {
    fail(`${archivePath} Info.plist CFBundleShortVersionString is not semver-like: ${bundleVersion}`);
  }
}

async function validateAppTarGzArchive(archivePath, latest) {
  let entries;
  try {
    entries = await listTarEntries(archivePath);
  } catch (error) {
    fail(`Unable to read .app.tar.gz archive: ${archivePath} (${error.message})`);
  }

  const infoPlists = entries.filter((entry) => /(^|\/)[^/]+\.app\/Contents\/Info\.plist$/.test(entry));
  if (infoPlists.length === 0) fail(`${archivePath} missing *.app/Contents/Info.plist`);
  if (infoPlists.length > 1) fail(`${archivePath} contains multiple Info.plist files: ${infoPlists.join(", ")}`);

  const infoPlistPath = infoPlists[0];
  const appRoot = infoPlistPath.slice(0, -"/Contents/Info.plist".length);
  const infoPlistBuffer = await readTarEntry(archivePath, infoPlistPath);
  let plistData;
  try {
    plistData = plist.parse(infoPlistBuffer.toString("utf8"));
  } catch (error) {
    fail(`${archivePath} Info.plist could not be parsed: ${error.message}`);
  }

  validateInfoPlist(plistData, archivePath, latest);

  const executablePath = `${appRoot}/Contents/MacOS/${EXPECTED_BUNDLE_EXECUTABLE}`;
  if (!entries.includes(executablePath)) fail(`${archivePath} missing app executable: ${executablePath}`);

  if (!hasTarEntry(entries, (entry) => entry.startsWith(`${appRoot}/Contents/Resources/`) && entry !== `${appRoot}/Contents/Resources/`)) {
    fail(`${archivePath} missing non-empty Contents/Resources`);
  }

  const hasServerResource = hasTarEntry(
    entries,
    (entry) =>
      entry.includes("/Contents/Resources/resources/server/package.json") ||
      entry.includes("/Contents/Resources/resources/server/dist/") ||
      entry.includes("/Contents/Resources/resources/server/src/")
  );
  if (!hasServerResource) fail(`${archivePath} missing bundled server resources marker`);

  const hasNodePtyResource = hasTarEntry(
    entries,
    (entry) =>
      entry.includes("/node_modules/node-pty/") ||
      entry.includes("/node_modules/node-pty-prebuilt-multiarch/") ||
      entry.includes("/prebuilds/darwin-")
  );
  if (!hasNodePtyResource) fail(`${archivePath} missing node-pty/prebuilds marker`);

  console.log(
    `[desktop-artifacts] .app.tar.gz contents: ${path.relative(process.cwd(), archivePath)} (${appRoot}, ${plistData.CFBundleShortVersionString})`
  );
}

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundleDir = path.resolve(args.bundleDir);
  if (!existsSync(bundleDir)) fail(`Bundle directory does not exist: ${bundleDir}`);

  const entries = walk(bundleDir);
  const latest = parseLatestJson(bundleDir, entries);
  await validateLatestJson(latest, entries);

  for (const requirement of args.requirements) {
    const rule = REQUIREMENTS[requirement];
    const matches = entries.filter((entry) => rule.match(entry.path, entry.stats));
    if (matches.length === 0) fail(`Missing required artifact: ${rule.label}`);

    for (const match of matches) {
      const size = artifactSize(match);
      if (size <= 0) fail(`Artifact is empty: ${match.path}`);
      console.log(`[desktop-artifacts] ${rule.label}: ${path.relative(process.cwd(), match.path)} (${size} bytes)`);
      if (requirement === "app-tar-gz") await validateAppTarGzArchive(match.path, latest);
    }
  }

  console.log("[desktop-artifacts] Desktop bundle artifact checks passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[desktop-artifacts] ERROR: ${redactSecrets(error?.message || String(error))}`);
    process.exitCode = 1;
  });
}
