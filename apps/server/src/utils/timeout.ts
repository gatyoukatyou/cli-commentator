/**
 * Options for withTimeout utility
 */
export interface TimeoutOptions<E extends Error> {
  /** Timeout in milliseconds */
  ms: number;
  /** Factory function to create the timeout error */
  timeoutError: () => E;
  /** Optional AbortSignal to listen for external abort */
  signal?: AbortSignal;
  /** Callback when timeout fires (before reject) */
  onTimeout?: () => void;
}

/**
 * Wraps a promise with timeout and abort signal handling.
 *
 * Features:
 * 1. Rejects immediately if signal is already aborted
 * 2. Rejects on timeout with custom error
 * 3. Rejects on signal abort event
 * 4. Cleans up timer and listener on settle
 */
export async function withTimeout<T, E extends Error>(
  promise: Promise<T>,
  options: TimeoutOptions<E>
): Promise<T> {
  const { ms, timeoutError, signal, onTimeout } = options;

  // 1. 開始時に既に abort されていたら即 reject
  if (signal?.aborted) {
    throw timeoutError();
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  let settled = false;

  const cleanup = () => {
    if (timeoutId) clearTimeout(timeoutId);
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
  };

  const timeoutPromise = new Promise<never>((_, reject) => {
    // 2. タイマーでタイムアウト
    timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout?.();
      reject(timeoutError());
    }, ms);

    // 3. signal の abort イベントでも reject
    if (signal) {
      abortHandler = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(timeoutError());
      };
      signal.addEventListener("abort", abortHandler);
    }
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    settled = true;
    return result;
  } finally {
    cleanup();
  }
}
