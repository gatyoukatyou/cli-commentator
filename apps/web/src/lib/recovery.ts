export type DesktopServerState = "stopped" | "starting" | "running" | "stopping" | "failed";

export type RecoveryGuidance = {
  category: string;
  summary: string;
  primaryAction: string;
  hints: string[];
  diagnostics: string[];
};

type FailureContext = {
  source: string;
  normalizedSource: string;
  category: string | null;
  fields: Record<string, string>;
  normalizedFields: Record<string, string>;
};

function normalize(text: string | null | undefined): string {
  return (text ?? "").toLowerCase();
}

function parseFailureContext(source: string): FailureContext {
  const fields: Record<string, string> = {};
  const normalizedFields: Record<string, string> = {};
  const trimmedSource = source.trim();

  for (const segment of trimmedSource.split("|").map((part) => part.trim())) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    const key = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (!key || !value) continue;
    fields[key] = value;
    normalizedFields[normalize(key)] = normalize(value);
  }

  const normalizedSource = normalize(trimmedSource);
  const categoryMatch = normalizedSource.match(/\[([a-z0-9_]+)\]/);
  return {
    source: trimmedSource,
    normalizedSource,
    category: categoryMatch?.[1] ?? null,
    fields,
    normalizedFields,
  };
}

function hasCategory(context: FailureContext, category: string): boolean {
  return context.category === category || context.normalizedSource.includes(`[${category}]`);
}

function isPortConflict(context: FailureContext): boolean {
  return (
    (hasCategory(context, "unexpected_exit") && context.normalizedFields.port_in_use === "true") ||
    (context.normalizedSource.includes("port") &&
      (context.normalizedSource.includes("in use") || context.normalizedSource.includes("already")))
  );
}

function isProjectRootError(context: FailureContext): boolean {
  return (
    hasCategory(context, "project_root") ||
    context.normalizedSource.includes("failed to get project root") ||
    context.normalizedSource.includes("canonicalize")
  );
}

function isPortResolveError(context: FailureContext): boolean {
  return hasCategory(context, "port_resolve") || context.normalizedSource.includes("no available server port was found");
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
    context.normalizedSource.includes("sidecar manifest") ||
    context.normalizedSource.includes("bundled node binary") ||
    context.normalizedSource.includes("bundled server entry") ||
    context.normalizedSource.includes("bundled server root")
  );
}

function isPermissionError(context: FailureContext): boolean {
  return (
    context.normalizedSource.includes("permission denied") ||
    context.normalizedSource.includes("operation not permitted")
  );
}

function isStopFlowError(context: FailureContext): boolean {
  return (
    hasCategory(context, "stop_process") ||
    hasCategory(context, "wait_shutdown") ||
    hasCategory(context, "inspect_before_stop") ||
    context.normalizedSource.includes("failed to stop server process") ||
    context.normalizedSource.includes("failed to wait for server shutdown") ||
    context.normalizedSource.includes("failed to inspect server process before stop")
  );
}

function isUnexpectedExit(context: FailureContext): boolean {
  return (
    hasCategory(context, "unexpected_exit") ||
    hasCategory(context, "process_state") ||
    hasCategory(context, "missing_process_handle") ||
    context.normalizedSource.includes("exited unexpectedly") ||
    context.normalizedSource.includes("process handle is missing") ||
    context.normalizedSource.includes("failed to read server process state")
  );
}

function addDiagnosticHint(diagnostics: string[], label: string, value: string | undefined) {
  if (!value) return;
  diagnostics.push(`${label}=${value}`);
}

export function getDesktopFailureGuidance(
  state: DesktopServerState,
  statusError: string | null | undefined,
  invokeError: string | null | undefined
): RecoveryGuidance | null {
  if (state !== "failed" && !invokeError) {
    return null;
  }

  const context = parseFailureContext(`${statusError ?? ""} ${invokeError ?? ""}`);

  if (isPortConflict(context) || isPortResolveError(context)) {
    const diagnostics: string[] = [];
    const hints = [
      "Desktop は既定 8787 から、使用中なら 8788 以降へ自動退避します。",
      "多数のポートが占有されていないか確認してください（必要に応じて `lsof -i :8787-:8850`）。",
      "固定ポートで再現したいときだけ `CLI_COMMENTATOR_PORT` を指定してください。",
    ];
    const preferred = context.fields.preferred;
    const attempts = context.fields.attempts;
    if (preferred || attempts) {
      diagnostics.push(`preferred=${preferred ?? "?"}, attempts=${attempts ?? "?"}`);
    }
    if (context.fields.port && context.normalizedFields.port_in_use === "true") {
      diagnostics.push(`port=${context.fields.port} is already in use`);
    }
    addDiagnosticHint(diagnostics, "port", context.fields.port);

    return {
      category: "ポート解決エラー",
      summary: "既定ポートが使用中か、起動に使えるポートを確保できていません。",
      primaryAction: "ポート競合を解消してから Retry Start を押してください。",
      hints,
      diagnostics,
    };
  }

  if (isProjectRootError(context)) {
    return {
      category: "起動ディレクトリエラー",
      summary: "Desktop がサーバー起動に必要なプロジェクトルートを解決できていません。",
      primaryAction: "リポジトリルートから `pnpm dev:desktop:managed` を起動し直してください。",
      hints: [
        "アプリの起動ディレクトリがリポジトリ外になっていないか確認してください。",
        "シンボリックリンク越しのパスや削除済みディレクトリを指していないか確認してください。",
      ],
      diagnostics: [],
    };
  }

  if (isPermissionError(context)) {
    const diagnostics: string[] = [];
    const hints = [
      "実行権限と作業ディレクトリの権限を確認してください。",
      "配布アプリなら quarantine / 権限設定、開発環境なら `resources` と `binaries` の権限を確認してください。",
    ];
    addDiagnosticHint(diagnostics, "cwd", context.fields.cwd);
    addDiagnosticHint(diagnostics, "node", context.fields.node);
    addDiagnosticHint(diagnostics, "entry", context.fields.entry);

    return {
      category: "権限エラー",
      summary: "Desktop は起動対象に到達できていますが、実行または読み取り権限で失敗しています。",
      primaryAction: "権限を修正してから Retry Start を押してください。",
      hints,
      diagnostics,
    };
  }

  if (isSidecarRuntimeError(context)) {
    const diagnostics: string[] = [];
    const hints = [
      "Desktop 同梱物（`resources/server` / `sidecar-manifest.json` / `binaries/node-*`）の存在を確認してください。",
      "配布物なら再インストール、開発環境なら `pnpm prepare:desktop-sidecar` の再実行を優先してください。",
    ];
    let summary = "Desktop が bundled sidecar の構成ファイルまたは実行物を見つけられていません。";
    let primaryAction = "sidecar 同梱物を作り直してから Retry Start を押してください。";
    if (hasCategory(context, "sidecar_manifest_parse")) {
      summary = "sidecar-manifest.json は見つかっていますが、内容の読み取りに失敗しています。";
      primaryAction = "`sidecar-manifest.json` の JSON 形式を修正してから Retry Start を押してください。";
      hints.unshift("manifest のキー名や JSON 末尾カンマ崩れを確認してください。");
    }
    if (hasCategory(context, "sidecar_manifest_parent")) {
      summary = "Desktop アプリの `Contents/Resources` 配置が期待どおりに解決できていません。";
      primaryAction = "アプリ配置を確認するか、開発環境なら sidecar 配置を作り直してください。";
      hints.unshift("Desktopアプリの配置先（`Contents/Resources`）が壊れていないか確認してください。");
    }
    if (hasCategory(context, "sidecar_manifest_missing")) {
      primaryAction = "開発環境なら `pnpm prepare:desktop-sidecar` を実行し、配布物なら再インストールしてください。";
    }
    addDiagnosticHint(diagnostics, "manifest", context.fields.manifest);
    addDiagnosticHint(diagnostics, "node_binary", context.fields.node_binary);
    addDiagnosticHint(diagnostics, "server_entry", context.fields.server_entry);
    addDiagnosticHint(diagnostics, "server_root", context.fields.server_root);
    addDiagnosticHint(diagnostics, "candidates", context.fields.candidates);

    return {
      category: "同梱ランタイムエラー",
      summary,
      primaryAction,
      hints,
      diagnostics,
    };
  }

  if (isStopFlowError(context)) {
    const diagnostics: string[] = [];
    addDiagnosticHint(diagnostics, "error", context.fields.error);
    return {
      category: "停止処理エラー",
      summary: "既存プロセスの停止または状態確認で失敗しており、内部状態が中途半端な可能性があります。",
      primaryAction: "Desktop を再起動して状態をリセットしてから Stop / Start を再試行してください。",
      hints: [
        "再現する場合は `desktop/server-event` ログを添えて報告してください。",
        "連続操作で起きる場合は Stop 完了表示を待ってから次の Start を押してください。",
      ],
      diagnostics,
    };
  }

  if (isUnexpectedExit(context)) {
    const diagnostics: string[] = [];
    const hints = [
      "同梱 server entry（`resources/server/dist/index.js`）の実行ログを確認してください。",
      "直前の `desktop/server-event` に `unexpected_exit` / `process_state` が出ていないか確認してください。",
    ];
    addDiagnosticHint(diagnostics, "exit_code", context.fields.exit_code);
    addDiagnosticHint(diagnostics, "port", context.fields.port);
    addDiagnosticHint(diagnostics, "port_in_use", context.fields.port_in_use);

    return {
      category: "サーバープロセス異常終了",
      summary: "サーバープロセスは起動開始まで進んでいますが、ヘルス安定前に終了しています。",
      primaryAction: "原因ログを確認してから Retry Start を実行してください。",
      hints,
      diagnostics,
    };
  }

  return {
    category: "要確認",
    summary: "既知分類に当てはまらないため、エラーメッセージ全体の確認が必要です。",
    primaryAction: "表示中のエラー本文を確認し、原因を解消してから Start を再試行してください。",
    hints: [
      "再現する場合は `desktop/server-event` ログとあわせて確認してください。",
    ],
    diagnostics: [],
  };
}
