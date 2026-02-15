export type DesktopServerState = "stopped" | "starting" | "running" | "stopping" | "failed";

export type RecoveryGuidance = {
  category: string;
  hints: string[];
};

type FailureContext = {
  source: string;
  category: string | null;
  fields: Record<string, string>;
};

function normalize(text: string | null | undefined): string {
  return (text ?? "").toLowerCase();
}

function parseFailureContext(source: string): FailureContext {
  const fields: Record<string, string> = {};
  for (const segment of source.split("|").map((part) => part.trim())) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    const key = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (!key || !value) continue;
    fields[key] = value;
  }

  const categoryMatch = source.match(/\[([a-z0-9_]+)\]/);
  return {
    source,
    category: categoryMatch?.[1] ?? null,
    fields,
  };
}

function hasCategory(context: FailureContext, category: string): boolean {
  return context.category === category || context.source.includes(`[${category}]`);
}

function isPortConflict(context: FailureContext): boolean {
  return (
    (hasCategory(context, "unexpected_exit") && context.source.includes("port_in_use=true")) ||
    (context.source.includes("port") && (context.source.includes("in use") || context.source.includes("already")))
  );
}

function isProjectRootError(context: FailureContext): boolean {
  return (
    hasCategory(context, "project_root") ||
    context.source.includes("failed to get project root") ||
    context.source.includes("canonicalize")
  );
}

function isPortResolveError(context: FailureContext): boolean {
  return hasCategory(context, "port_resolve") || context.source.includes("no available server port was found");
}

function isSidecarRuntimeError(context: FailureContext): boolean {
  return (
    hasCategory(context, "spawn") ||
    hasCategory(context, "sidecar_manifest_parent") ||
    hasCategory(context, "sidecar_manifest_missing") ||
    hasCategory(context, "sidecar_manifest_read") ||
    hasCategory(context, "sidecar_manifest_parse") ||
    hasCategory(context, "sidecar_node_missing") ||
    hasCategory(context, "sidecar_server_entry_missing") ||
    hasCategory(context, "sidecar_server_root_missing") ||
    context.source.includes("sidecar manifest") ||
    context.source.includes("bundled node binary") ||
    context.source.includes("bundled server entry") ||
    context.source.includes("bundled server root")
  );
}

function isPermissionError(context: FailureContext): boolean {
  return context.source.includes("permission denied") || context.source.includes("operation not permitted");
}

function isStopFlowError(context: FailureContext): boolean {
  return (
    hasCategory(context, "stop_process") ||
    hasCategory(context, "wait_shutdown") ||
    hasCategory(context, "inspect_before_stop") ||
    context.source.includes("failed to stop server process") ||
    context.source.includes("failed to wait for server shutdown") ||
    context.source.includes("failed to inspect server process before stop")
  );
}

function isUnexpectedExit(context: FailureContext): boolean {
  return (
    hasCategory(context, "unexpected_exit") ||
    hasCategory(context, "process_state") ||
    hasCategory(context, "missing_process_handle") ||
    context.source.includes("exited unexpectedly") ||
    context.source.includes("process handle is missing") ||
    context.source.includes("failed to read server process state")
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

  const context = parseFailureContext(normalize(`${statusError ?? ""} ${invokeError ?? ""}`));

  if (isPortConflict(context) || isPortResolveError(context)) {
    const hints = [
      "Desktop は既定 8787 から、使用中なら 8788 以降へ自動退避します。",
      "多数のポートが占有されていないか確認してください（必要に応じて `lsof -i :8787-:8850`）。",
      "必要なら `CLI_COMMENTATOR_PORT` で開始ポートを指定して Start を再試行してください。",
    ];
    const preferred = context.fields.preferred;
    const attempts = context.fields.attempts;
    if (preferred || attempts) {
      hints.push(`検出情報: preferred=${preferred ?? "?"}, attempts=${attempts ?? "?"}`);
    }
    if (context.fields.port && context.fields.port_in_use === "true") {
      hints.push(`検出情報: port=${context.fields.port} が使用中です。`);
    }

    return {
      category: "ポート解決エラー",
      hints,
    };
  }

  if (isProjectRootError(context)) {
    return {
      category: "起動ディレクトリエラー",
      hints: [
        "アプリの起動ディレクトリがリポジトリ外になっていないか確認してください。",
        "リポジトリルートから `pnpm dev:desktop:managed` を実行してください。",
      ],
    };
  }

  if (isPermissionError(context)) {
    return {
      category: "権限エラー",
      hints: [
        "実行権限と作業ディレクトリの権限を確認してください。",
        "権限修正後に Start を押して再試行してください。",
      ],
    };
  }

  if (isSidecarRuntimeError(context)) {
    const hints = [
      "Desktop 同梱物（`resources/server` / `sidecar-manifest.json` / `binaries/node-*`）の存在を確認してください。",
      "開発環境では `pnpm prepare:desktop-sidecar` を再実行して同梱物を作り直してください。",
      "修正後に Start を押して再試行してください。",
    ];
    if (hasCategory(context, "sidecar_manifest_parse")) {
      hints.unshift("`sidecar-manifest.json` のJSON形式が壊れていないか確認してください。");
    }
    if (hasCategory(context, "sidecar_manifest_parent")) {
      hints.unshift("Desktopアプリの配置先（`Contents/Resources`）が壊れていないか確認してください。");
    }

    return {
      category: "同梱ランタイムエラー",
      hints,
    };
  }

  if (isStopFlowError(context)) {
    return {
      category: "停止処理エラー",
      hints: [
        "停止処理中にプロセス制御で失敗しています。",
        "Desktop を再起動して状態をリセットしてから Stop / Start を再試行してください。",
        "再現する場合は `desktop/server-event` ログを添えて報告してください。",
      ],
    };
  }

  if (isUnexpectedExit(context)) {
    const hints = [
      "サーバープロセスが起動後すぐに終了しています。",
      "同梱 server entry（`resources/server/dist/index.js`）の実行ログを確認してください。",
      "原因解消後に Retry Start を実行してください。",
    ];
    if (context.fields.exit_code) {
      hints.push(`検出情報: exit_code=${context.fields.exit_code}`);
    }

    return {
      category: "サーバープロセス異常終了",
      hints,
    };
  }

  return {
    category: "要確認",
    hints: ["エラーメッセージを確認して原因を解消し、Start で再試行してください。"],
  };
}
