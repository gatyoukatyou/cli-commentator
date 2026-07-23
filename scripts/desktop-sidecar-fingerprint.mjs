import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";

export const SIDECAR_FINGERPRINT_VERSION = 1;

const SIDECAR_INPUTS = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "apps/server/package.json",
  "apps/server/tsconfig.build.json",
  "apps/server/src",
  "packages/shared/package.json",
  "packages/shared/src",
  "scripts/desktop-sidecar-fingerprint.mjs",
  "scripts/prepare-desktop-sidecar.mjs",
];

function collectFiles(repoRoot, relativePath, files) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    files.push({ relativePath, missing: true });
    return;
  }

  const stat = statSync(absolutePath);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(absolutePath).sort()) {
      collectFiles(repoRoot, path.join(relativePath, entry), files);
    }
    return;
  }

  if (stat.isFile()) {
    files.push({ relativePath, missing: false });
  }
}

export function listDesktopSidecarInputFiles(repoRoot) {
  const files = [];
  for (const relativePath of SIDECAR_INPUTS) {
    collectFiles(repoRoot, relativePath, files);
  }
  return files.sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, "en")
  );
}

export function computeDesktopSidecarFingerprint(repoRoot) {
  const hash = createHash("sha256");
  hash.update(`version:${SIDECAR_FINGERPRINT_VERSION}\0`);

  const files = listDesktopSidecarInputFiles(repoRoot);
  for (const file of files) {
    const normalizedPath = file.relativePath.split(path.sep).join("/");
    hash.update(`path:${normalizedPath}\0`);
    if (file.missing) {
      hash.update("missing\0");
      continue;
    }
    hash.update(readFileSync(path.join(repoRoot, file.relativePath)));
    hash.update("\0");
  }

  return hash.digest("hex");
}
