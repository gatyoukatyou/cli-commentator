/**
 * Recognises what kind of failure a log excerpt describes.
 *
 * Rulesets collapse every failure into a single summary ("エラーが出ている"), so
 * both the spoken urgent line and the displayed explanation would otherwise say
 * only that something failed. Detection lives here, shared, while each layer
 * keeps its own wording: speech needs one short clause, display can explain.
 *
 * Patterns are ordered from specific to general, and the first match wins.
 */
const FAILURE_PATTERNS = [
  ["type-error", /\bTS\d{4,5}\b/u],
  ["port-in-use", /EADDRINUSE|address already in use/iu],
  ["permission", /\bEACCES\b|\bEPERM\b|permission denied/iu],
  ["module-not-found", /Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Module not found/iu],
  ["command-not-found", /command not found|:\s*not found\b/iu],
  ["exit-code", /ELIFECYCLE|exited with code|exit code|failed with exit code|non-zero exit/iu],
];

export function classifyFailure(detail) {
  if (!detail) return null;
  return FAILURE_PATTERNS.find(([, pattern]) => pattern.test(detail))?.[0] ?? null;
}
