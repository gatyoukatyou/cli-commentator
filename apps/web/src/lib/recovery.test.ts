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
    expect(result?.summary).toContain("ポート");
    expect(result?.primaryAction).toContain("Retry Start");
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
    expect(result?.primaryAction).toContain("dev:desktop:managed");
  });

  it("classifies structured project root errors", () => {
    const result = getDesktopFailureGuidance("failed", "[project_root] Failed to get project root | error=...", null);
    expect(result?.category).toBe("起動ディレクトリエラー");
  });

  it("classifies sidecar runtime errors", () => {
    const result = getDesktopFailureGuidance("failed", "[sidecar_manifest_missing] No sidecar manifest was found", null);
    expect(result?.category).toBe("同梱ランタイムエラー");
    expect(result?.primaryAction).toContain("prepare:desktop-sidecar");
  });

  it("preserves raw diagnostic paths for sidecar runtime errors", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[sidecar_manifest_read] Failed to read sidecar manifest | manifest=/Applications/CLI Commentator/Contents/Resources/sidecar-manifest.json",
      null
    );
    expect(result?.category).toBe("同梱ランタイムエラー");
    expect(result?.diagnostics.join(" ")).toContain(
      "manifest=/Applications/CLI Commentator/Contents/Resources/sidecar-manifest.json"
    );
  });

  it("classifies sidecar manifest parent errors", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[sidecar_manifest_parent] Failed to resolve sidecar manifest parent directory",
      null
    );
    expect(result?.category).toBe("同梱ランタイムエラー");
    expect(result?.hints[0]).toContain("Contents/Resources");
  });

  it("classifies permission errors", () => {
    const result = getDesktopFailureGuidance("failed", "Failed to start server: permission denied", null);
    expect(result?.category).toBe("権限エラー");
  });

  it("adds structured diagnostics for permission errors", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[spawn] Failed to spawn server process | error=permission denied | cwd=/Users/home/AION_Project/repos/cli-commentator/apps/server | entry=/Users/home/AION_Project/repos/cli-commentator/apps/server/dist/index.js",
      null
    );
    expect(result?.category).toBe("権限エラー");
    expect(result?.primaryAction).toContain("Retry Start");
    expect(result?.diagnostics.join(" ")).toContain("cwd=/Users/home/AION_Project/repos/cli-commentator/apps/server");
    expect(result?.diagnostics.join(" ")).toContain(
      "entry=/Users/home/AION_Project/repos/cli-commentator/apps/server/dist/index.js"
    );
  });

  it("classifies stop flow errors", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[wait_shutdown] Failed to wait for server shutdown | error=timeout",
      null
    );
    expect(result?.category).toBe("停止処理エラー");
    expect(result?.hints.join(" ")).toContain("desktop/server-event");
    expect(result?.primaryAction).toContain("Desktop を再起動");
  });

  it("classifies unexpected exit errors", () => {
    const result = getDesktopFailureGuidance("failed", "Server exited unexpectedly with code 1", null);
    expect(result?.category).toBe("サーバープロセス異常終了");
    expect(result?.hints.join(" ")).toContain("resources/server/dist/index.js");
    expect(result?.primaryAction).toContain("Retry Start");
  });

  it("adds structured port diagnostics when available", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[port_resolve] No available server port was found | preferred=8787 | attempts=64",
      null
    );
    expect(result?.category).toBe("ポート解決エラー");
    expect(result?.diagnostics.join(" ")).toContain("preferred=8787");
    expect(result?.diagnostics.join(" ")).toContain("attempts=64");
  });

  it("adds exit code diagnostics for structured unexpected exit", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[unexpected_exit] Server exited unexpectedly | exit_code=signal_or_unknown | port=8787 | port_in_use=false",
      null
    );
    expect(result?.category).toBe("サーバープロセス異常終了");
    expect(result?.diagnostics.join(" ")).toContain("exit_code=signal_or_unknown");
  });

  it("adds missing sidecar file diagnostics when available", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[sidecar_node_missing] Bundled node binary is missing | node_binary=/Applications/CLI Commentator.app/Contents/Resources/binaries/node-aarch64-apple-darwin | candidates=/Applications/CLI Commentator.app/Contents/Resources/binaries/node-aarch64-apple-darwin,/Applications/CLI Commentator.app/Contents/MacOS/node",
      null
    );
    expect(result?.category).toBe("同梱ランタイムエラー");
    expect(result?.diagnostics.join(" ")).toContain(
      "node_binary=/Applications/CLI Commentator.app/Contents/Resources/binaries/node-aarch64-apple-darwin"
    );
    expect(result?.diagnostics.join(" ")).toContain("candidates=/Applications/CLI Commentator.app/Contents/Resources");
  });

  it("falls back to generic guidance for unknown errors", () => {
    const result = getDesktopFailureGuidance("failed", "some unknown failure", null);
    expect(result?.category).toBe("要確認");
    expect(result?.summary).toContain("既知分類");
    expect(result?.hints).toHaveLength(1);
    expect(result?.diagnostics).toHaveLength(0);
  });
});
