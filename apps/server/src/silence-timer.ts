export const DEFAULT_SILENCE_TIMEOUT_MS = 60_000;

export function parseSilenceTimeoutMs(
  value: string | undefined,
  fallback = DEFAULT_SILENCE_TIMEOUT_MS
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface SilenceTimer {
  start(): void;
  activity(): void;
  stop(): void;
}

export function createSilenceTimer(options: {
  thresholdMs: number;
  onSilence: () => void;
}): SilenceTimer {
  let active = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = () => {
    clear();
    if (!active) return;

    timer = setTimeout(() => {
      timer = null;
      if (!active) return;
      options.onSilence();
    }, options.thresholdMs);
  };

  return {
    start() {
      active = true;
      schedule();
    },
    activity() {
      if (!active) return;
      schedule();
    },
    stop() {
      active = false;
      clear();
    },
  };
}
