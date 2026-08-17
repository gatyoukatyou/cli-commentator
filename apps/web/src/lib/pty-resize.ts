import type { PtySize, WsIncoming } from "../types";

type ResizeSocket = Pick<WebSocket, "readyState" | "send">;

const WEB_SOCKET_OPEN = 1;
export const PTY_RESIZE_COALESCE_DELAY_MS = 50;

type PtyResizeCoalescerOptions = {
  getSocket: () => ResizeSocket | null;
  delayMs?: number;
};

export type PtyResizeCoalescer = {
  schedule: (size: PtySize) => void;
  resendLatest: () => boolean;
  dispose: () => void;
};

function sizeKey(size: PtySize): string {
  return `${size.cols}x${size.rows}`;
}

export function sendPtyResize(socket: ResizeSocket | null, size: PtySize | null): boolean {
  if (!socket || socket.readyState !== WEB_SOCKET_OPEN || !size) return false;

  const message: WsIncoming = { kind: "resizePty", cols: size.cols, rows: size.rows };
  socket.send(JSON.stringify(message));
  return true;
}

export function createPtyResizeCoalescer({
  getSocket,
  delayMs = PTY_RESIZE_COALESCE_DELAY_MS,
}: PtyResizeCoalescerOptions): PtyResizeCoalescer {
  let disposed = false;
  let latestSize: PtySize | null = null;
  let lastSentSizeKey: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearPendingTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const sendLatest = (force: boolean): boolean => {
    if (disposed || !latestSize) return false;
    if (!force && lastSentSizeKey === sizeKey(latestSize)) return false;

    const sent = sendPtyResize(getSocket(), latestSize);
    if (sent) {
      lastSentSizeKey = sizeKey(latestSize);
    }
    return sent;
  };

  return {
    schedule(size) {
      if (disposed) return;
      latestSize = size;
      clearPendingTimer();
      timer = setTimeout(() => {
        timer = null;
        sendLatest(false);
      }, delayMs);
    },
    resendLatest() {
      if (disposed) return false;
      clearPendingTimer();
      return sendLatest(true);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearPendingTimer();
      latestSize = null;
    },
  };
}
