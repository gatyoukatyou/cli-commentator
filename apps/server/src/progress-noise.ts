export function isCodexProgressNoise(text: string): boolean {
  return (
    /^working\s*\(\d+s\s*[•·]\s*esc to interrupt\)$/i.test(text) ||
    /^\d+s\s*[•·]\s*esc to interrupt\)?$/i.test(text) ||
    /^[a-z]$/i.test(text) ||
    /^\d+[;?]+$/i.test(text) ||
    /^[.•·]\d+$/i.test(text)
  );
}
