import { describe, expect, it } from "vitest";
import { getDesktopFailureGuidance } from "./recovery";

describe("getDesktopFailureGuidance", () => {
  it("returns null when there is no failure context", () => {
    const result = getDesktopFailureGuidance("running", null, null);
    expect(result).toBeNull();
  });

  it("classifies port conflict errors", () => {
    const result = getDesktopFailureGuidance("failed", "Server exited unexpectedly; port 8787 is already in use", null);
    expect(result?.category).toBe("ポート競合");
    expect(result?.hints[0]).toContain("8787");
  });

  it("classifies structured unexpected-exit port conflicts", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[unexpected_exit] Server exited unexpectedly | exit_code=1 | port=8787 | port_in_use=true",
      null
    );
    expect(result?.category).toBe("ポート競合");
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

  it("classifies dependency and command errors", () => {
    const result = getDesktopFailureGuidance("failed", "Failed to start server: pnpm: command not found", null);
    expect(result?.category).toBe("依存関係/実行コマンドエラー");
    expect(result?.hints.join(" ")).toContain("pnpm install");
  });

  it("classifies permission errors", () => {
    const result = getDesktopFailureGuidance("failed", "Failed to start server: permission denied", null);
    expect(result?.category).toBe("権限エラー");
  });

  it("classifies unexpected exit errors", () => {
    const result = getDesktopFailureGuidance("failed", "Server exited unexpectedly with code 1", null);
    expect(result?.category).toBe("サーバープロセス異常終了");
  });

  it("falls back to generic guidance for unknown errors", () => {
    const result = getDesktopFailureGuidance("failed", "some unknown failure", null);
    expect(result?.category).toBe("要確認");
    expect(result?.hints).toHaveLength(1);
  });
});
