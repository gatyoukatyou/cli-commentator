export type PtyOwnerRole = "controller" | "observer";
export type PtyOwnerClientKind = "desktop" | "web" | "unknown";

export type PtyOwnerRegistry = {
  register: (client: object, clientId: string, clientKind: PtyOwnerClientKind) => PtyOwnerRole;
  unregister: (client: object) => void;
  isController: (client: object) => boolean;
  controllerId: () => string | null;
};

/**
 * Keeps one stable client identity in control of the server-wide PTY.
 * A disconnected controller remains reserved so a reconnecting Desktop client
 * can recover control without an observer taking it over in the meantime.
 */
export function createPtyOwnerRegistry(): PtyOwnerRegistry {
  let controllerClientId: string | null = null;
  let controllerClientKind: PtyOwnerClientKind | null = null;
  const clients = new Map<object, string>();

  return {
    register(client, clientId, clientKind) {
      clients.set(client, clientId);
      if (controllerClientId === null && clientKind !== "unknown") {
        controllerClientId = clientId;
        controllerClientKind = clientKind;
      } else if (clientKind === "desktop" && controllerClientKind === "web") {
        controllerClientId = clientId;
        controllerClientKind = clientKind;
      }
      return clientId === controllerClientId ? "controller" : "observer";
    },

    unregister(client) {
      clients.delete(client);
    },

    isController(client) {
      const clientId = clients.get(client);
      return clientId !== undefined && clientId === controllerClientId;
    },

    controllerId() {
      return controllerClientId;
    },
  };
}
