/**
 * Redact sensitive information from text.
 * Applied at the earliest stage (before event extraction) to prevent leaks.
 *
 * Design principles:
 * - Process patterns from specific to general
 * - Use prefix-based patterns (low false positives)
 * - Keep generic long-token pattern conservative
 * - Preserve readability where possible
 */

/**
 * Patterns for redaction.
 * Order matters: more specific patterns should come first.
 */
const patterns: Array<{ re: RegExp; replacement: string | ((match: string) => string) }> = [
  // --- Private Key Blocks (preserve structure for readability) ---
  // Matches: RSA, EC, DSA, OPENSSH, ENCRYPTED, and generic PRIVATE KEY
  // Preserves the key type in BEGIN/END markers for readability
  {
    re: /-----BEGIN\s+((?:[A-Z]+\s+)?PRIVATE\s+KEY)-----[\s\S]*?-----END\s+(?:[A-Z]+\s+)?PRIVATE\s+KEY-----/g,
    replacement: (match: string) => {
      // Extract the key type from BEGIN marker
      const keyTypeMatch = match.match(/-----BEGIN\s+((?:[A-Z]+\s+)?PRIVATE\s+KEY)-----/);
      const keyType = keyTypeMatch?.[1] ?? "PRIVATE KEY";
      return `-----BEGIN ${keyType}-----\n[REDACTED PRIVATE KEY]\n-----END ${keyType}-----`;
    },
  },

  // --- Bearer tokens (JWT, OAuth) ---
  {
    re: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
    replacement: "Bearer [REDACTED]",
  },

  // --- Anthropic API keys (sk-ant-*) - must come before generic sk- ---
  {
    re: /sk-ant-[A-Za-z0-9\-_]{20,}/g,
    replacement: "sk-ant-[REDACTED]",
  },

  // --- OpenAI API keys (sk-*) ---
  // Handles both classic (sk-xxx) and new format (sk-proj-xxx)
  {
    re: /sk-[A-Za-z0-9\-_]{20,}/g,
    replacement: "sk-[REDACTED]",
  },

  // --- GitHub tokens ---
  // ghp_ = Personal Access Token (classic)
  // github_pat_ = Fine-grained Personal Access Token
  // gho_ = OAuth Access Token
  // ghu_ = GitHub App User Token
  // ghs_ = GitHub App Installation Token
  // ghr_ = GitHub App Refresh Token
  {
    re: /ghp_[A-Za-z0-9]{20,}/g,
    replacement: "ghp_[REDACTED]",
  },
  {
    re: /github_pat_[A-Za-z0-9_]{20,}/g,
    replacement: "github_pat_[REDACTED]",
  },
  {
    re: /gho_[A-Za-z0-9]{20,}/g,
    replacement: "gho_[REDACTED]",
  },
  {
    re: /ghu_[A-Za-z0-9]{20,}/g,
    replacement: "ghu_[REDACTED]",
  },
  {
    re: /ghs_[A-Za-z0-9]{20,}/g,
    replacement: "ghs_[REDACTED]",
  },
  {
    re: /ghr_[A-Za-z0-9]{20,}/g,
    replacement: "ghr_[REDACTED]",
  },

  // --- Slack tokens ---
  // xoxb- = Bot Token
  // xoxp- = User Token
  // xoxa- = App Token
  // xoxs- = Session Token
  // xoxr- = Refresh Token
  {
    re: /xoxb-[A-Za-z0-9\-]{10,}/g,
    replacement: "xoxb-[REDACTED]",
  },
  {
    re: /xoxp-[A-Za-z0-9\-]{10,}/g,
    replacement: "xoxp-[REDACTED]",
  },
  {
    re: /xoxa-[A-Za-z0-9\-]{10,}/g,
    replacement: "xoxa-[REDACTED]",
  },
  {
    re: /xoxs-[A-Za-z0-9\-]{10,}/g,
    replacement: "xoxs-[REDACTED]",
  },
  {
    re: /xoxr-[A-Za-z0-9\-]{10,}/g,
    replacement: "xoxr-[REDACTED]",
  },

  // --- Google API keys (AIza*) ---
  // Google API keys start with "AIza" followed by ~35 characters
  {
    re: /AIza[A-Za-z0-9\-_]{30,}/g,
    replacement: "AIza[REDACTED]",
  },

  // --- AWS keys ---
  // Access Key ID: AKIA* (permanent) or ASIA* (temporary STS)
  // Both are 20 characters total
  {
    re: /AKIA[A-Z0-9]{16}/g,
    replacement: "AKIA[REDACTED]",
  },
  {
    re: /ASIA[A-Z0-9]{16}/g,
    replacement: "ASIA[REDACTED]",
  },
  // AWS Secret Access Key: 40 characters, typically follows ACCESS_KEY pattern
  // Match when preceded by common env var patterns
  {
    re: /(?:AWS_SECRET_ACCESS_KEY|aws_secret_access_key|SecretAccessKey)\s*[=:]\s*[A-Za-z0-9/+=]{40}/g,
    replacement: (match: string) => {
      const prefix = match.match(/^[^=:]+[=:]\s*/)?.[0] ?? "";
      return prefix + "[REDACTED]";
    },
  },
];

/**
 * Redact sensitive information from text.
 *
 * @param text - Input text that may contain secrets
 * @returns Text with secrets replaced by [REDACTED] markers
 */
export function redact(text: string): string {
  let result = text;

  for (const { re, replacement } of patterns) {
    if (typeof replacement === "string") {
      result = result.replace(re, replacement);
    } else {
      result = result.replace(re, replacement);
    }
  }

  return result;
}
