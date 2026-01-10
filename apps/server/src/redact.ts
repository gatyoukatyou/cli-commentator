export function redact(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*/g, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9]{20,}/g, "sk-[REDACTED]")
    .replace(/[A-Za-z0-9_\-]{32,}/g, (m) => (m.length >= 48 ? "[REDACTED_TOKEN]" : m));
}
