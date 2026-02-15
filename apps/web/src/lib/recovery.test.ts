import { describe, expect, it } from "vitest";
import { getDesktopFailureGuidance } from "./recovery";

describe("getDesktopFailureGuidance", () => {
  it("returns null when there is no failure context", () => {
    const result = getDesktopFailureGuidance("running", null, null);
    expect(result).toBeNull();
  });

  it("classifies port conflict errors", () => {
    const result = getDesktopFailureGuidance("failed", "Server exited unexpectedly; port 8787 is already in use", null);
    expect(result?.category).toBe("ポート解決エラー");
    expect(result?.hints[0]).toContain("自動退避");
  });

  it("classifies structured unexpected-exit port conflicts", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[unexpected_exit] Server exited unexpectedly | exit_code=1 | port=8787 | port_in_use=true",
      null
    );
    expect(result?.category).toBe("ポート解決エラー");
  });

  it("classifies structured port resolve failures", () => {
    const result = getDesktopFailureGuidance("failed", "[port_resolve] No available server port was found | preferred=8787", null);
    expect(result?.category).toBe("ポート解決エラー");
  });

  it("classifies project root errors", () => {
    const result = getDesktopFailureGuidance("failed", "Failed to get project root: canonicalize failed", null);
    expect(result?.category).toBe("起動ディレクトリエラー");
    expect(result?.hints.join(" ")).toContain("dev:desktop:managed");
  });

  it("classifies structured project root errors", () => {
    const result = getDesktopFailureGuidance("failed", "[project_root] Failed to get project root | error=...", null);
    expect(result?.category).toBe("起動ディレクトリエラー");
  });

  it("classifies sidecar runtime errors", () => {
    const result = getDesktopFailureGuidance("failed", "[sidecar_manifest_missing] No sidecar manifest was found", null);
    expect(result?.category).toBe("同梱ランタイムエラー");
    expect(result?.hints.join(" ")).toContain("prepare:desktop-sidecar");
  });

  it("classifies permission errors", () => {
    const result = getDesktopFailureGuidance("failed", "Failed to start server: permission denied", null);
    expect(result?.category).toBe("権限エラー");
  });

  it("classifies unexpected exit errors", () => {
    const result = getDesktopFailureGuidance("failed", "Server exited unexpectedly with code 1", null);
    expect(result?.category).toBe("サーバープロセス異常終了");
    expect(result?.hints.join(" ")).toContain("resources/server/dist/index.js");
  });

  it("falls back to generic guidance for unknown errors", () => {
    const result = getDesktopFailureGuidance("failed", "some unknown failure", null);
    expect(result?.category).toBe("要確認");
    expect(result?.hints).toHaveLength(1);
  });
});
