export type FileFallbackDecision =
  | { enabled: true; filePath: string }
  | { enabled: false; reason: "missing_input_file" | "file_not_found" };

export function resolveFileFallback(
  inputFile: string | undefined,
  fileExists: (path: string) => boolean
): FileFallbackDecision {
  const filePath = (inputFile ?? "").trim();
  if (!filePath) {
    return { enabled: false, reason: "missing_input_file" };
  }
  if (!fileExists(filePath)) {
    return { enabled: false, reason: "file_not_found" };
  }
  return { enabled: true, filePath };
}
