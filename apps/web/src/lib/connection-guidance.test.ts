import { describe, expect, it } from "vitest";

import { getConnectionGuidance } from "./connection-guidance";

const web = { isDesktopRuntime: false, desktopServerState: null } as const;
const desktop = { isDesktopRuntime: true } as const;

describe("getConnectionGuidance", () => {
  it("says nothing extra while connected", () => {
    expect(
      getConnectionGuidance({ connectionStatus: "connected", ...web })
    ).toEqual({ label: "接続中", hint: null });
  });

  it("says nothing extra during the first connection attempt", () => {
    expect(
      getConnectionGuidance({ connectionStatus: "connecting", ...web }).hint
    ).toBeNull();
  });

  it("explains that reconnection is automatic", () => {
    const guidance = getConnectionGuidance({
      connectionStatus: "reconnecting",
      ...web,
    });

    expect(guidance.label).toContain("再接続");
    expect(guidance.hint).toContain("自動");
  });

  describe("web UI running on its own", () => {
    it("names the missing server and the command that starts it", () => {
      const guidance = getConnectionGuidance({
        connectionStatus: "disconnected",
        ...web,
      });

      expect(guidance.label).toBe("切断（サーバー未接続）");
      expect(guidance.hint).toContain("pnpm dev:server");
    });

    it("does not mention the desktop panel", () => {
      const guidance = getConnectionGuidance({
        connectionStatus: "disconnected",
        ...web,
      });

      expect(guidance.hint).not.toContain("Start");
      expect(guidance.hint).not.toContain("Desktop Server");
    });
  });

  describe("desktop managed mode", () => {
    it("points at Start when the server is stopped", () => {
      const guidance = getConnectionGuidance({
        connectionStatus: "disconnected",
        ...desktop,
        desktopServerState: "stopped",
      });

      expect(guidance.label).toBe("切断（サーバー停止中）");
      expect(guidance.hint).toContain("Start");
    });

    it("points at Start when the desktop state is not known yet", () => {
      const guidance = getConnectionGuidance({
        connectionStatus: "disconnected",
        ...desktop,
        desktopServerState: null,
      });

      expect(guidance.hint).toContain("Start");
    });

    it("asks the user to wait while the server is starting", () => {
      const guidance = getConnectionGuidance({
        connectionStatus: "disconnected",
        ...desktop,
        desktopServerState: "starting",
      });

      expect(guidance.label).toContain("起動を待っています");
      expect(guidance.hint).toContain("running");
    });

    it("routes to the recovery card when startup failed", () => {
      const guidance = getConnectionGuidance({
        connectionStatus: "disconnected",
        ...desktop,
        desktopServerState: "failed",
      });

      expect(guidance.label).toContain("失敗");
      expect(guidance.hint).toContain("復旧カード");
    });

    it("suspects a port mismatch when the server is running but unreachable", () => {
      const guidance = getConnectionGuidance({
        connectionStatus: "disconnected",
        ...desktop,
        desktopServerState: "running",
      });

      expect(guidance.label).toBe("切断（サーバーは動作中）");
      expect(guidance.hint).toContain("ポート");
    });

    it("stays quiet during an intentional stop", () => {
      const guidance = getConnectionGuidance({
        connectionStatus: "disconnected",
        ...desktop,
        desktopServerState: "stopping",
      });

      expect(guidance.hint).toBeNull();
    });

    it("never tells a desktop user to run pnpm dev:server", () => {
      const states = [
        "stopped",
        "starting",
        "running",
        "stopping",
        "failed",
        null,
      ] as const;

      for (const desktopServerState of states) {
        const guidance = getConnectionGuidance({
          connectionStatus: "disconnected",
          ...desktop,
          desktopServerState,
        });

        expect(guidance.hint ?? "").not.toContain("pnpm dev:server");
      }
    });
  });
});
