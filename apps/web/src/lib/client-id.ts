const CLIENT_ID_STORAGE_KEY = "cli-commentator-client-id";

function createClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Keep one identity per browser tab so WebSocket reconnects retain control. */
export function getSessionClientId(): string {
  try {
    const existing = window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing) return existing;

    const clientId = createClientId();
    window.sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
    return clientId;
  } catch {
    return createClientId();
  }
}
