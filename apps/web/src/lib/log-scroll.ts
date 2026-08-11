export const LOG_AUTO_SCROLL_THRESHOLD_PX = 64;

export type LogScrollMetrics = {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
};

export function getDistanceToLogBottom({ scrollHeight, scrollTop, clientHeight }: LogScrollMetrics): number {
  return Math.max(0, scrollHeight - scrollTop - clientHeight);
}

export function isAtLogLatest(
  metrics: LogScrollMetrics,
  threshold = LOG_AUTO_SCROLL_THRESHOLD_PX
): boolean {
  return getDistanceToLogBottom(metrics) <= threshold;
}

export function getLatestLogScrollTop({ scrollHeight, clientHeight }: LogScrollMetrics): number {
  return Math.max(0, scrollHeight - clientHeight);
}
