import type { PtySize, WsIncoming } from "../types";

type ResizeSocket = Pick<WebSocket, "readyState" | "send">;

const WEB_SOCKET_OPEN = 1;

export function sendPtyResize(socket: ResizeSocket | null, size: PtySize | null): boolean {
  if (!socket || socket.readyState !== WEB_SOCKET_OPEN || !size) return false;

  const message: WsIncoming = { kind: "resizePty", cols: size.cols, rows: size.rows };
  socket.send(JSON.stringify(message));
  return true;
}
