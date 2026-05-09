import { useEffect, useState } from "react";
import { getDesktopFailureGuidance, type DesktopServerState } from "../lib/recovery";
import { copyWithFallback, getTauriCore, type ServerStatusDetail } from "../lib/tauri";

type UpdaterCheckStatus = {
  configured: boolean;
  available: boolean;
  currentVersion: string;
  version: string | null;
  date: string | null;
  body: string | null;
  error: string | null;
};

type DesktopDiagnostics = {
  version: string;
  platform: string;
  arch: string;
  logDir: string | null;
  configDir: string | null;
};

type TauriStatusPanelProps = {
  onStatusChange?: (status: ServerStatusDetail | null) => void;
};

const DESKTOP_STATE_LABEL: Record<DesktopServerState, string> = {
  stopped: "停止中",
  starting: "起動中",
  running: "稼働中",
  stopping: "停止処理中",
  failed: "失敗",
};

const errorToMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "toString" in error) return String(error);
  return "Unknown error";
};

export default function TauriStatusPanel({ onStatusChange }: TauriStatusPanelProps) {
  const isTauri = Boolean(getTauriCore());
  const [status, setStatus] = useState<ServerStatusDetail | null>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [autostartEnabled, setAutostartEnabled] = useState<boolean | null>(null);
  const [autostartLoading, setAutostartLoading] = useState(false);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterCheckStatus | null>(null);
  const [updaterCheckedAt, setUpdaterCheckedAt] = useState<Date | null>(null);
  const [updaterLoading, setUpdaterLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DesktopDiagnostics | null>(null);
  const [copiedDiagnosticAction, setCopiedDiagnosticAction] = useState<string | null>(null);
  const [copiedRecoveryCommand, setCopiedRecoveryCommand] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri) {
      onStatusChange?.(null);
      return;
    }
    let cancelled = false;

    const poll = async () => {
      const core = getTauriCore();
      if (!core) return;
      try {
        const result = await core.invoke("server_status");
        if (cancelled) return;
        const nextStatus = result as ServerStatusDetail;
        setStatus(nextStatus);
        onStatusChange?.(nextStatus);
        setInvokeError(null);
      } catch (err) {
        if (cancelled) return;
        setInvokeError(errorToMessage(err));
      }
    };

    poll();
    const interval = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isTauri, onStatusChange]);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;

    const fetchDesktopMetadata = async () => {
      const core = getTauriCore();
      if (!core) return;
      try {
        const [autostartResult, diagnosticsResult] = await Promise.all([
          core.invoke("autostart_status"),
          core.invoke("desktop_diagnostics"),
        ]);
        if (cancelled) return;
        setAutostartEnabled(Boolean(autostartResult));
        setDiagnostics(diagnosticsResult as DesktopDiagnostics);
      } catch (err) {
        if (cancelled) return;
        setInvokeError(errorToMessage(err));
      }
    };

    fetchDesktopMetadata();
    return () => {
      cancelled = true;
    };
  }, [isTauri]);

  if (!isTauri) return null;

  const state: DesktopServerState = status?.state ?? "stopped";

  const handleStart = async () => {
    const core = getTauriCore();
    if (!core) return;
    try {
      const result = await core.invoke("server_start");
      const nextStatus = result as ServerStatusDetail;
      setStatus(nextStatus);
      onStatusChange?.(nextStatus);
      setInvokeError(null);
    } catch (err) {
      setInvokeError(errorToMessage(err));
    }
  };

  const handleStop = async () => {
    const core = getTauriCore();
    if (!core) return;
    try {
      const result = await core.invoke("server_stop");
      const nextStatus = result as ServerStatusDetail;
      setStatus(nextStatus);
      onStatusChange?.(nextStatus);
      setInvokeError(null);
    } catch (err) {
      setInvokeError(errorToMessage(err));
    }
  };

  const handleToggleAutostart = async () => {
    const core = getTauriCore();
    if (!core || autostartEnabled === null) return;
    setAutostartLoading(true);
    try {
      const command = autostartEnabled ? "autostart_disable" : "autostart_enable";
      const result = await core.invoke(command);
      setAutostartEnabled(Boolean(result));
      setInvokeError(null);
    } catch (err) {
      setInvokeError(errorToMessage(err));
    } finally {
      setAutostartLoading(false);
    }
  };

  const handleCheckUpdater = async () => {
    const core = getTauriCore();
    if (!core) return;
    setUpdaterLoading(true);
    try {
      const result = await core.invoke("updater_check");
      setUpdaterStatus(result as UpdaterCheckStatus);
      setUpdaterCheckedAt(new Date());
      setInvokeError(null);
    } catch (err) {
      const message = errorToMessage(err);
      setUpdaterStatus({
        configured: false,
        available: false,
        currentVersion: diagnostics?.version ?? "unknown",
        version: null,
        date: null,
        body: null,
        error: message,
      });
      setUpdaterCheckedAt(new Date());
      setInvokeError(message);
    } finally {
      setUpdaterLoading(false);
    }
  };

  const getStateColor = (value: DesktopServerState) => {
    if (value === "running") return "var(--color-success)";
    if (value === "failed") return "var(--color-danger)";
    if (value === "starting" || value === "stopping") return "var(--color-warning)";
    return "var(--color-fg-secondary)";
  };

  const stateMessage = (() => {
    if (state === "starting") return "サーバー起動処理中です。完了まで数秒待ってください。";
    if (state === "running") return "サーバーは稼働中です。実況UIが接続されます。";
    if (state === "stopping") return "サーバー停止処理中です。";
    if (state === "failed") return "起動に失敗しました。原因を解消して Start を再試行してください。";
    return "サーバーは停止しています。Start で起動できます。";
  })();

  const failureGuidance = getDesktopFailureGuidance(state, status?.error ?? null, invokeError);

  const startDisabled = state === "starting" || state === "running" || state === "stopping";
  const stopDisabled = state === "stopped" || state === "stopping" || state === "failed";
  const startLabel = state === "failed" ? "Retry Start" : "Start";
  const autostartLabel = autostartEnabled === null ? "確認中" : autostartEnabled ? "有効" : "無効";
  const autostartButtonLabel =
    autostartEnabled === null ? "読み込み中..." : autostartEnabled ? "自動起動を無効化" : "自動起動を有効化";
  const autostartButtonDisabled = autostartLoading || autostartEnabled === null;
  const updaterLabel = (() => {
    if (updaterLoading) return "Checking...";
    if (!updaterStatus) return "Not checked";
    if (updaterStatus.error) return "Failed";
    if (!updaterStatus.configured) return "Not configured";
    if (updaterStatus.available) return `Update available (latest: v${updaterStatus.version ?? "?"})`;
    return "Up-to-date";
  })();
  const updaterNotice = (() => {
    if (!updaterStatus) return null;
    if (updaterStatus.error) {
      const details = [
        updaterStatus.error,
        "確認ポイント:",
        "- ネットワーク接続と GitHub への到達性",
        "- Release の latest.json / .app.tar.gz / .sig の有無",
        "- docs/desktop-release の Updater 配布契約",
        "Copy Debug bundle を添えて共有してください。",
      ];
      return {
        text: details.join("\n"),
        className: "debug-panel__alert--crash",
      };
    }
    if (updaterStatus.available) {
      const details = [
        `新しいバージョン v${updaterStatus.version ?? "?"} が利用可能です。`,
        updaterStatus.date ? `公開日: ${updaterStatus.date}` : "",
        updaterStatus.body?.trim() ? `内容: ${updaterStatus.body.trim()}` : "",
      ].filter(Boolean);
      return {
        text: details.join("\n"),
        className: "debug-panel__alert--warning",
      };
    }
    return null;
  })();
  const updaterMeta =
    updaterStatus && updaterStatus.configured && !updaterStatus.available && !updaterStatus.error
      ? `現在のバージョン v${updaterStatus.currentVersion} は最新です。`
      : null;

  const handleCopyRecoveryCommand = async (command: string) => {
    const copied = await copyWithFallback(command);
    if (!copied) {
      setInvokeError("復旧コマンドのコピーに失敗しました。");
      return;
    }
    setCopiedRecoveryCommand(command);
    window.setTimeout(() => {
      setCopiedRecoveryCommand((current) => (current === command ? null : current));
    }, 1600);
  };

  const copyDiagnosticText = async (action: string, text: string) => {
    const copied = await copyWithFallback(text);
    if (!copied) {
      setInvokeError("診断情報のコピーに失敗しました。");
      return;
    }
    setCopiedDiagnosticAction(action);
    window.setTimeout(() => {
      setCopiedDiagnosticAction((current) => (current === action ? null : current));
    }, 2000);
  };

  const formatDiagnosticTimestamp = (value: number | null | undefined) => {
    if (!value) return "-";
    return new Date(value).toLocaleString();
  };

  const buildDebugBundle = () => {
    const version = diagnostics?.version ? `v${diagnostics.version}` : "-";
    const platform =
      diagnostics?.platform || diagnostics?.arch
        ? `${diagnostics?.platform ?? "-"}/${diagnostics?.arch ?? "-"}`
        : "-";
    const health = status ? (status.health_ok ? "OK" : "NG") : "-";
    const updaterResult = (() => {
      if (updaterLoading) return "checking";
      if (!updaterStatus) return "not checked";
      if (!updaterStatus.configured) return "not configured";
      if (updaterStatus.error) return "NG";
      if (updaterStatus.available) return `update available (${updaterStatus.version ?? "unknown"})`;
      return "OK";
    })();

    return [
      "CLI Commentator Desktop",
      `Version: ${version}`,
      `Platform: ${platform}`,
      "Desktop server:",
      `- State: ${status?.state ?? state}`,
      `- Health: ${health}`,
      `- PID: ${status?.pid ?? "-"}`,
      `- Port: ${status?.port ?? "-"}`,
      `- Started at: ${formatDiagnosticTimestamp(status?.started_at)}`,
      `- Last health: ${formatDiagnosticTimestamp(status?.last_seen_at)}`,
      status?.error ? `- Error: ${status.error}` : null,
      invokeError ? `- Panel error: ${invokeError}` : null,
      "Updater:",
      `- Result: ${updaterResult}`,
      `- Last checked: ${updaterCheckedAt ? updaterCheckedAt.toLocaleString() : "-"}`,
      `- Current version: ${updaterStatus?.currentVersion ? `v${updaterStatus.currentVersion}` : version}`,
      updaterStatus?.version ? `- Available version: v${updaterStatus.version}` : null,
      updaterStatus?.date ? `- Release date: ${updaterStatus.date}` : null,
      updaterStatus?.error ? `- Error: ${updaterStatus.error}` : null,
      "Paths:",
      `- Logs: ${diagnostics?.logDir ?? "-"}`,
      `- Config: ${diagnostics?.configDir ?? "-"}`,
      `Timestamp: ${new Date().toLocaleString()}`,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  };

  return (
    <div className="debug-panel">
      <div className="debug-panel__title">Desktop Server</div>
      <p className="debug-panel__hint">{stateMessage}</p>

      {status && (
        <div className="debug-panel__status">
          <div className="debug-panel__row">
            <span className="debug-panel__label">State</span>
            <span className="debug-panel__badge" style={{ color: getStateColor(state) }}>
              {DESKTOP_STATE_LABEL[state]}
            </span>
          </div>
          <div className="debug-panel__row">
            <span className="debug-panel__label">Health</span>
            <span style={{ color: status.health_ok ? "var(--color-success)" : "var(--color-danger)" }}>
              {status.health_ok ? "OK" : "NG"}
            </span>
          </div>
          <div className="debug-panel__row">
            <span className="debug-panel__label">PID</span>
            <span>{status.pid ?? "-"}</span>
          </div>
          <div className="debug-panel__row">
            <span className="debug-panel__label">Port</span>
            <span>{status.port}</span>
          </div>
          <div className="debug-panel__row">
            <span className="debug-panel__label">Auto-start</span>
            <span>{autostartLabel}</span>
          </div>
          <div className="debug-panel__row">
            <span className="debug-panel__label">Update</span>
            <span className="debug-panel__value">{updaterLabel}</span>
          </div>
          <div className="debug-panel__row">
            <span className="debug-panel__label">Last checked</span>
            <span>{updaterCheckedAt ? updaterCheckedAt.toLocaleTimeString() : "-"}</span>
          </div>
          {diagnostics && (
            <>
              <div className="debug-panel__row">
                <span className="debug-panel__label">Version</span>
                <span>v{diagnostics.version}</span>
              </div>
              <div className="debug-panel__row">
                <span className="debug-panel__label">Platform</span>
                <span>
                  {diagnostics.platform}/{diagnostics.arch}
                </span>
              </div>
            </>
          )}
          {status.transitioned_at && (
            <div className="debug-panel__meta">
              状態更新: {new Date(status.transitioned_at).toLocaleTimeString()}
            </div>
          )}
          {status.started_at && (
            <div className="debug-panel__meta">
              起動時刻: {new Date(status.started_at).toLocaleTimeString()}
            </div>
          )}
          {status.last_seen_at && (
            <div className="debug-panel__meta">
              最終ヘルス応答: {new Date(status.last_seen_at).toLocaleTimeString()}
            </div>
          )}
          {status.error && <div className="debug-panel__alert debug-panel__alert--crash">{status.error}</div>}
        </div>
      )}
      {invokeError && <div className="debug-panel__alert debug-panel__alert--warning">{invokeError}</div>}
      {updaterMeta && <div className="debug-panel__meta">{updaterMeta}</div>}
      {updaterNotice && (
        <div className={`debug-panel__alert ${updaterNotice.className}`}>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{updaterNotice.text}</pre>
        </div>
      )}
      {diagnostics && (
        <section className="debug-panel__recovery-card" aria-label="desktop diagnostics">
          <div className="debug-panel__recovery-header">
            <div className="debug-panel__meta">Troubleshooting</div>
            <div className="debug-panel__recovery-summary">問い合わせ時は Version、Platform、Logs path を添えてください。</div>
          </div>
          <div className="debug-panel__diagnostic-list">
            <div className="debug-panel__actions debug-panel__actions--wrap">
              <button
                type="button"
                className="debug-panel__btn debug-panel__btn--secondary"
                onClick={() => {
                  void copyDiagnosticText(
                    "version-platform",
                    [`Version: v${diagnostics.version}`, `Platform: ${diagnostics.platform}/${diagnostics.arch}`].join("\n")
                  );
                }}
              >
                {copiedDiagnosticAction === "version-platform" ? "Copied" : "Copy Version/Platform"}
              </button>
              <button
                type="button"
                className="debug-panel__btn debug-panel__btn--secondary"
                onClick={() => {
                  void copyDiagnosticText("debug-bundle", buildDebugBundle());
                }}
              >
                {copiedDiagnosticAction === "debug-bundle" ? "Copied" : "Copy Debug bundle"}
              </button>
            </div>
            {diagnostics.logDir && (
              <div className="debug-panel__diagnostic-path">
                <span className="debug-panel__recovery-label">Logs path</span>
                <code className="debug-panel__command-code">{diagnostics.logDir}</code>
                <button
                  type="button"
                  className="debug-panel__copy-btn"
                  onClick={() => {
                    void copyDiagnosticText("logs-path", diagnostics.logDir ?? "");
                  }}
                >
                  {copiedDiagnosticAction === "logs-path" ? "Copied" : "Copy Logs path"}
                </button>
              </div>
            )}
            {diagnostics.configDir && (
              <div className="debug-panel__diagnostic-path">
                <span className="debug-panel__recovery-label">Config path</span>
                <code className="debug-panel__command-code">{diagnostics.configDir}</code>
                <button
                  type="button"
                  className="debug-panel__copy-btn"
                  onClick={() => {
                    void copyDiagnosticText("config-path", diagnostics.configDir ?? "");
                  }}
                >
                  {copiedDiagnosticAction === "config-path" ? "Copied" : "Copy Config path"}
                </button>
              </div>
            )}
          </div>
        </section>
      )}
      {failureGuidance && (
        <section className="debug-panel__recovery-card" aria-label="startup recovery guidance">
          <div className="debug-panel__recovery-header">
            <div className="debug-panel__meta">想定原因: {failureGuidance.category}</div>
            <div className="debug-panel__recovery-summary">{failureGuidance.summary}</div>
          </div>
          <div className="debug-panel__recovery-primary">
            <span className="debug-panel__recovery-label">最初のアクション</span>
            <p>{failureGuidance.primaryAction}</p>
          </div>
          {failureGuidance.hints.length > 0 && (
            <div className="debug-panel__recovery-section">
              <span className="debug-panel__recovery-label">確認ポイント</span>
              <ul className="debug-panel__recovery">
                {failureGuidance.hints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            </div>
          )}
          {failureGuidance.diagnostics.length > 0 && (
            <div className="debug-panel__recovery-section">
              <span className="debug-panel__recovery-label">診断情報</span>
              <ul className="debug-panel__diagnostics">
                {failureGuidance.diagnostics.map((diagnostic) => (
                  <li key={diagnostic}>
                    <code>{diagnostic}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {failureGuidance.commands.length > 0 && (
            <div className="debug-panel__recovery-section">
              <span className="debug-panel__recovery-label">試すコマンド</span>
              <div className="debug-panel__command-list">
                {failureGuidance.commands.map((command) => (
                  <div className="debug-panel__command" key={command.command}>
                    <div className="debug-panel__command-meta">{command.label}</div>
                    <code className="debug-panel__command-code">{command.command}</code>
                    <button
                      type="button"
                      className="debug-panel__copy-btn"
                      onClick={() => {
                        void handleCopyRecoveryCommand(command.command);
                      }}
                    >
                      {copiedRecoveryCommand === command.command ? "Copied" : "Copy"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <div className="debug-panel__actions">
        <button className="debug-panel__btn debug-panel__btn--primary" onClick={handleStart} disabled={startDisabled}>
          {startLabel}
        </button>
        <button className="debug-panel__btn debug-panel__btn--secondary" onClick={handleStop} disabled={stopDisabled}>
          Stop
        </button>
      </div>
      <div className="debug-panel__actions">
        <button
          className="debug-panel__btn debug-panel__btn--secondary"
          onClick={handleToggleAutostart}
          disabled={autostartButtonDisabled}
        >
          {autostartLoading ? "更新中..." : autostartButtonLabel}
        </button>
      </div>
      <div className="debug-panel__actions">
        <button className="debug-panel__btn debug-panel__btn--secondary" onClick={handleCheckUpdater} disabled={updaterLoading}>
          {updaterLoading ? "Checking..." : "Check updates"}
        </button>
      </div>
    </div>
  );
}
