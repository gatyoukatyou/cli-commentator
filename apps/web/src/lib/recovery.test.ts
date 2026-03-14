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
    expect(result?.commands[0]?.command).toBe("lsof -i :8787");
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
    expect(result?.commands.map((item) => item.command)).toContain("pnpm prepare:desktop-sidecar");
  });

  it("preserves raw diagnostic paths for sidecar runtime errors", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[sidecar_manifest_read] Failed to read sidecar manifest | manifest=/Applications/CLI Commentator/Contents/Resources/sidecar-manifest.json | error=permission denied",
      null
    );
    expect(result?.category).toBe("同梱ランタイムエラー");
    expect(result?.diagnostics.join(" ")).toContain(
      "manifest=/Applications/CLI Commentator/Contents/Resources/sidecar-manifest.json"
    );
    expect(result?.summary).toContain("読み取り時に失敗");
    expect(result?.diagnostics.join(" ")).toContain("error=permission denied");
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

  it("classifies sidecar manifest parse errors", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[sidecar_manifest_parse] Failed to parse sidecar manifest | manifest=/Applications/CLI Commentator/Contents/Resources/sidecar-manifest.json | error=expected value at line 1 column 1",
      null
    );
    expect(result?.category).toBe("同梱ランタイムエラー");
    expect(result?.summary).toContain("内容の読み取りに失敗");
    expect(result?.primaryAction).toContain("JSON 形式");
    expect(result?.diagnostics.join(" ")).toContain("error=expected value at line 1 column 1");
  });

  it("classifies permission errors", () => {
    const result = getDesktopFailureGuidance("failed", "Failed to start server: permission denied", null);
    expect(result?.category).toBe("権限エラー");
    expect(result?.commands[0]?.command).toBe("pnpm verify:internal-release");
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
    expect(result?.commands[0]?.command).toContain("ls -l");
  });

  it("classifies non-permission spawn errors with runtime diagnostics", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[spawn] Failed to start server | error=exec format error | port=8787 | node=/Applications/CLI Commentator.app/Contents/MacOS/node | entry=/Applications/CLI Commentator.app/Contents/Resources/server/dist/index.js | cwd=/Applications/CLI Commentator.app/Contents/Resources/server",
      null
    );
    expect(result?.category).toBe("起動プロセス生成エラー");
    expect(result?.summary).toContain("server プロセス");
    expect(result?.primaryAction).toContain("node");
    expect(result?.diagnostics.join(" ")).toContain("port=8787");
    expect(result?.diagnostics.join(" ")).toContain("error=exec format error");
    expect(result?.commands[0]?.command).toContain("/Applications/CLI Commentator.app/Contents/MacOS/node");
    expect(result?.commands.map((item) => item.command)).toContain("pnpm verify:internal-release");
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

  it("classifies inspect-before-stop errors as stop flow errors", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[inspect_before_stop] Failed to inspect server process before stop | error=access denied",
      null
    );
    expect(result?.category).toBe("停止処理エラー");
    expect(result?.diagnostics.join(" ")).toContain("error=access denied");
  });

  it("classifies unexpected exit errors", () => {
    const result = getDesktopFailureGuidance("failed", "Server exited unexpectedly with code 1", null);
    expect(result?.category).toBe("サーバープロセス異常終了");
    expect(result?.hints.join(" ")).toContain("resources/server/dist/index.js");
    expect(result?.primaryAction).toContain("Retry Start");
  });

  it("classifies process state errors as unexpected exits", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[process_state] Failed to read server process state | error=io failure",
      null
    );
    expect(result?.category).toBe("サーバープロセス異常終了");
    expect(result?.diagnostics.join(" ")).toContain("error=io failure");
  });

  it("classifies missing process handle errors as unexpected exits", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[missing_process_handle] Server process handle is missing while running | port=8787",
      null
    );
    expect(result?.category).toBe("サーバープロセス異常終了");
    expect(result?.diagnostics.join(" ")).toContain("port=8787");
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
    expect(result?.commands[0]?.command).toBe("pnpm verify:internal-release");
  });

  it("adds missing sidecar file diagnostics when available", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[sidecar_node_missing] Bundled node binary is missing | sidecar_root=/Applications/CLI Commentator.app/Contents/Resources | node_binary=/Applications/CLI Commentator.app/Contents/Resources/binaries/node-aarch64-apple-darwin | candidates=/Applications/CLI Commentator.app/Contents/Resources/binaries/node-aarch64-apple-darwin,/Applications/CLI Commentator.app/Contents/MacOS/node",
      null
    );
    expect(result?.category).toBe("同梱ランタイムエラー");
    expect(result?.diagnostics.join(" ")).toContain(
      "node_binary=/Applications/CLI Commentator.app/Contents/Resources/binaries/node-aarch64-apple-darwin"
    );
    expect(result?.diagnostics.join(" ")).toContain("candidates=/Applications/CLI Commentator.app/Contents/Resources");
    expect(result?.diagnostics.join(" ")).toContain("sidecar_root=/Applications/CLI Commentator.app/Contents/Resources");
    expect(result?.summary).toContain("bundled Node");
  });

  it("surfaces sidecar server entry guidance", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[sidecar_server_entry_missing] Bundled server entry is missing | manifest=/Applications/CLI Commentator.app/Contents/Resources/sidecar-manifest.json | sidecar_root=/Applications/CLI Commentator.app/Contents/Resources | server_entry=/Applications/CLI Commentator.app/Contents/Resources/server/dist/index.js",
      null
    );
    expect(result?.category).toBe("同梱ランタイムエラー");
    expect(result?.summary).toContain("bundled server entry");
    expect(result?.primaryAction).toContain("resources/server/dist/index.js");
    expect(result?.commands.map((item) => item.command)).toContain("pnpm verify:internal-release");
  });

  it("surfaces sidecar server root guidance", () => {
    const result = getDesktopFailureGuidance(
      "failed",
      "[sidecar_server_root_missing] Bundled server root is missing | manifest=/Applications/CLI Commentator.app/Contents/Resources/sidecar-manifest.json | sidecar_root=/Applications/CLI Commentator.app/Contents/Resources | server_root=/Applications/CLI Commentator.app/Contents/Resources/server",
      null
    );
    expect(result?.category).toBe("同梱ランタイムエラー");
    expect(result?.summary).toContain("bundled server root");
    expect(result?.primaryAction).toContain("resources/server");
    expect(result?.diagnostics.join(" ")).toContain("server_root=/Applications/CLI Commentator.app/Contents/Resources/server");
  });

  it("falls back to generic guidance for unknown errors", () => {
    const result = getDesktopFailureGuidance("failed", "some unknown failure", null);
    expect(result?.category).toBe("要確認");
    expect(result?.summary).toContain("既知分類");
    expect(result?.hints).toHaveLength(1);
    expect(result?.diagnostics).toHaveLength(0);
    expect(result?.commands).toHaveLength(0);
  });
});
