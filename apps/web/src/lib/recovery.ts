export type DesktopServerState = "stopped" | "starting" | "running" | "stopping" | "failed";

export type RecoveryGuidance = {
  category: string;
  hints: string[];
};

function normalize(text: string | null | undefined): string {
  return (text ?? "").toLowerCase();
}

function hasCategory(source: string, category: string): boolean {
  return source.includes(`[${category}]`);
}

function isPortConflict(source: string): boolean {
  return (
    (hasCategory(source, "unexpected_exit") && source.includes("port_in_use=true")) ||
    (source.includes("port") && (source.includes("in use") || source.includes("already")))
  );
}

function isProjectRootError(source: string): boolean {
  return hasCategory(source, "project_root") || source.includes("failed to get project root") || source.includes("canonicalize");
}

function isPortResolveError(source: string): boolean {
  return hasCategory(source, "port_resolve") || source.includes("no available server port was found");
}

function isSidecarRuntimeError(source: string): boolean {
  return (
    hasCategory(source, "spawn") ||
    hasCategory(source, "sidecar_manifest_missing") ||
    hasCategory(source, "sidecar_manifest_read") ||
    hasCategory(source, "sidecar_manifest_parse") ||
    hasCategory(source, "sidecar_node_missing") ||
    hasCategory(source, "sidecar_server_entry_missing") ||
    hasCategory(source, "sidecar_server_root_missing") ||
    source.includes("sidecar manifest") ||
    source.includes("bundled node binary") ||
    source.includes("bundled server entry") ||
    source.includes("bundled server root")
  );
}

function isPermissionError(source: string): boolean {
  return source.includes("permission denied") || source.includes("operation not permitted");
}

function isUnexpectedExit(source: string): boolean {
  return (
    hasCategory(source, "unexpected_exit") ||
    hasCategory(source, "process_state") ||
    hasCategory(source, "missing_process_handle") ||
    source.includes("exited unexpectedly") ||
    source.includes("process handle is missing") ||
    source.includes("failed to read server process state")
  );
}

export function getDesktopFailureGuidance(
  state: DesktopServerState,
  statusError: string | null | undefined,
  invokeError: string | null | undefined
): RecoveryGuidance | null {
  if (state !== "failed" && !invokeError) {
    return null;
  }

  const source = normalize(`${statusError ?? ""} ${invokeError ?? ""}`);

  if (isPortConflict(source) || isPortResolveError(source)) {
    return {
      category: "ポート解決エラー",
      hints: [
        "Desktop は既定 8787 から、使用中なら 8788 以降へ自動退避します。",
        "多数のポートが占有されていないか確認してください（必要に応じて `lsof -i :8787-:8850`）。",
        "必要なら `CLI_COMMENTATOR_PORT` で開始ポートを指定して Start を再試行してください。",
      ],
    };
  }

  if (isProjectRootError(source)) {
    return {
      category: "起動ディレクトリエラー",
      hints: [
        "アプリの起動ディレクトリがリポジトリ外になっていないか確認してください。",
        "リポジトリルートから `pnpm dev:desktop:managed` を実行してください。",
      ],
    };
  }

  if (isPermissionError(source)) {
    return {
      category: "権限エラー",
      hints: [
        "実行権限と作業ディレクトリの権限を確認してください。",
        "権限修正後に Start を押して再試行してください。",
      ],
    };
  }

  if (isSidecarRuntimeError(source)) {
    return {
      category: "同梱ランタイムエラー",
      hints: [
        "Desktop 同梱物（`resources/server` / `sidecar-manifest.json` / `binaries/node-*`）の存在を確認してください。",
        "開発環境では `pnpm prepare:desktop-sidecar` を再実行して同梱物を作り直してください。",
        "修正後に Start を押して再試行してください。",
      ],
    };
  }

  if (isUnexpectedExit(source)) {
    return {
      category: "サーバープロセス異常終了",
      hints: [
        "サーバープロセスが起動後すぐに終了しています。",
        "同梱 server entry（`resources/server/dist/index.js`）の実行ログを確認してください。",
        "原因解消後に Retry Start を実行してください。",
      ],
    };
  }

  return {
    category: "要確認",
    hints: ["エラーメッセージを確認して原因を解消し、Start で再試行してください。"],
  };
}
