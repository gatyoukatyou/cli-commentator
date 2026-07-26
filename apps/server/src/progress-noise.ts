export function isTerminalRenderingNoise(text: string): boolean {
  const compact = text.replace(/\s+/gu, "").trim();
  if (!compact) return true;

  return (
    /^\([A-Z0-2]$/u.test(compact) ||
    /^\d{1,3}[A-Z]?$/u.test(compact) ||
    /^[A-Za-z]\d{2,3}$/u.test(compact) ||
    /^[.•·]+\d*$/u.test(compact) ||
    /^[A-Za-z][A-Za-z ]{1,24}(?:…|\.{3})\d+$/u.test(compact) ||
    !/[\p{L}\p{N}]/u.test(compact)
  );
}

export function isCodexProgressNoise(text: string): boolean {
  return (
    /^working\s*\(\d+s\s*[•·]\s*esc to interrupt\)$/i.test(text) ||
    /^\d+s\s*[•·]\s*esc to interrupt\)?$/i.test(text) ||
    /^[a-z]$/i.test(text) ||
    /^\d+[;?]+$/i.test(text) ||
    /^[.•·]\d+$/i.test(text)
  );
}
