const MAX_RECENT_PATHS = 6;

export function normalizeRecentPath(path: string): string | null {
  const trimmed = path.trim();
  return trimmed ? trimmed : null;
}

export function addRecentPath(paths: string[], nextPath: string): string[] {
  const normalized = normalizeRecentPath(nextPath);
  if (!normalized) return paths;

  return [normalized, ...paths.filter((path) => path !== normalized)].slice(0, MAX_RECENT_PATHS);
}
