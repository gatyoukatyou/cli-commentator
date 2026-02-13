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

function isPnpmError(source: string): boolean {
  return hasCategory(source, "spawn") || source.includes("pnpm") || source.includes("failed to start server");
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

  if (isPortConflict(source)) {
    return {
      category: "ポート競合",
      hints: [
        "ポート 8787 を利用中のプロセスを停止してください。",
        "必要に応じて `lsof -i :8787` で使用中プロセスを確認してください。",
        "競合解消後に Start を押して再起動してください。",
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

  if (isPnpmError(source)) {
    return {
      category: "依存関係/実行コマンドエラー",
      hints: [
        "`pnpm install` を再実行し、依存関係の欠落がないか確認してください。",
        "`pnpm -C apps/server dev` を単体実行し、エラー詳細を確認してください。",
        "修正後に Start を押して再試行してください。",
      ],
    };
  }

  if (isUnexpectedExit(source)) {
    return {
      category: "サーバープロセス異常終了",
      hints: [
        "サーバープロセスが起動後すぐに終了しています。",
        "`pnpm -C apps/server dev` を単体で実行し、終了原因を確認してください。",
        "原因解消後に Retry Start を実行してください。",
      ],
    };
  }

  return {
    category: "要確認",
    hints: ["エラーメッセージを確認して原因を解消し、Start で再試行してください。"],
  };
}
