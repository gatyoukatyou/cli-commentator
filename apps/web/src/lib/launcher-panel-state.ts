export function getLauncherPanelCollapsed(sessionLabel: string, override: boolean | null): boolean {
  if (override !== null) return override;
  const normalizedSessionLabel = sessionLabel.trim();
  return normalizedSessionLabel.length > 0 && normalizedSessionLabel !== "bash";
}
