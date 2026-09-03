export function formatSessionStatusLabel(label: string, sessionEnded: boolean): string {
  const normalized = label.trim() || "session";
  return sessionEnded ? `${normalized}（終了済み）` : normalized;
}
