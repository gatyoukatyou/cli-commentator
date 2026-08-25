import type { DetectedSource, SourceMode } from "../types";

export const SOURCE_LABELS: Record<SourceMode, string> = {
  auto: "自動検出",
  claude: "Claude Code",
  codex: "Codex",
  hermes: "Hermes Agent",
  generic: "汎用",
};

export function sourceLabel(source: SourceMode): string {
  return SOURCE_LABELS[source];
}

export function detectedSourceLabel(source: DetectedSource | null): string {
  return source ? sourceLabel(source) : "";
}
