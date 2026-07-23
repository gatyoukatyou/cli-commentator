import { execFileSync, spawnSync } from "node:child_process";

const MACOS_SYSTEM_LIBRARY_PREFIXES = [
  "/System/Library/",
  "/usr/lib/",
];

export function parseOtoolDependencies(output) {
  return String(output)
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().match(/^(.+?)\s+\(compatibility version/))
    .filter(Boolean)
    .map((match) => match[1]);
}

export function findNonSystemMacOSDependencies(dependencies) {
  return dependencies.filter(
    (dependency) =>
      !MACOS_SYSTEM_LIBRARY_PREFIXES.some((prefix) =>
        dependency.startsWith(prefix)
      )
  );
}

export function assertMacOSNodeRuntimePortableFromOtool(nodePath, output) {
  const dependencies = parseOtoolDependencies(output);
  const nonSystemDependencies =
    findNonSystemMacOSDependencies(dependencies);

  if (nonSystemDependencies.length === 0) {
    return;
  }

  throw new Error(
    [
      "[sidecar_node_not_portable] Current Node runtime cannot be bundled as a single file.",
      `source=${nodePath}`,
      `non_system_dependencies=${nonSystemDependencies.join(",")}`,
      "Use a self-contained Node distribution (for example, Node from nodejs.org or actions/setup-node), then rerun `pnpm prepare:desktop-sidecar`.",
    ].join(" | ")
  );
}

export function assertNodeRuntimePortable(
  nodePath,
  {
    platform = process.platform,
    runOtool = execFileSync,
  } = {}
) {
  if (platform !== "darwin") {
    return;
  }

  let output;
  try {
    output = runOtool("otool", ["-L", nodePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[sidecar_node_dependency_inspection_failed] Failed to inspect Node runtime with otool. | source=${nodePath} | error=${detail}`
    );
  }

  assertMacOSNodeRuntimePortableFromOtool(nodePath, output);
}

export function smokeTestNodeRuntime(
  nodePath,
  expectedVersion,
  { runNode = spawnSync } = {}
) {
  const result = runNode(nodePath, ["--version"], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = String(result.stdout ?? "").trim();
  const stderr = String(result.stderr ?? "").trim();

  if (result.error || result.status !== 0) {
    const detail = result.error?.message || stderr || `exit=${result.status}`;
    throw new Error(
      `[sidecar_node_smoke_failed] Bundled Node runtime failed to start. | node=${nodePath} | error=${detail}`
    );
  }

  if (stdout !== expectedVersion) {
    throw new Error(
      `[sidecar_node_smoke_failed] Bundled Node runtime returned an unexpected version. | node=${nodePath} | expected=${expectedVersion} | actual=${stdout || "(empty)"}`
    );
  }
}
