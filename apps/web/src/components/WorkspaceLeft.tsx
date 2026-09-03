import { Suspense, lazy, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { LaunchDraft, LaunchPresetId } from "../lib/session-launcher";
import type { ProfileSummary, PtySize, Style } from "../types";
import { LauncherPanel } from "./LauncherPanel";
import { ProfileSelector } from "./ProfileSelector";
import { getLauncherPanelCollapsed } from "../lib/launcher-panel-state";
import { formatSessionStatusLabel } from "../lib/session-status";
import { copyWithFallback } from "../lib/tauri";
import type { TerminalPaneHandle, TerminalPaneTheme } from "./TerminalPane";
import {
  TERMINAL_FORCE_STOP_LABEL,
  TERMINAL_INTERRUPT_LABEL,
} from "../lib/terminal-interrupt";

const TerminalPane = lazy(() => import("./TerminalPane"));

type WorkspaceLeftProps = {
  launchDraft: LaunchDraft;
  setLaunchDraft: Dispatch<SetStateAction<LaunchDraft>>;
  style: Style;
  connected: boolean;
  onSelectPreset: (presetId: LaunchPresetId) => void;
  onLaunch: () => void;
  terminalPaneRef: RefObject<TerminalPaneHandle | null>;
  terminalTheme: TerminalPaneTheme;
  currentSessionLabel: string;
  sessionEnded: boolean;
  interruptArmed: boolean;
  onInterrupt: () => void;
  pendingTerminalOutput: string;
  onTerminalData: (data: string) => void;
  onTerminalResize: (size: PtySize) => void;
  onPendingOutputFlushed: () => void;
  onClearTerminal: () => void;
  profiles: ProfileSummary[];
  activeProfileId: string | null;
  onSelectProfile: (id: string | null) => void;
  onEditProfile: (id: string) => void;
  onCreateProfile: () => void;
  onDeleteProfile: (id: string) => void;
};

export function WorkspaceLeft({
  launchDraft,
  setLaunchDraft,
  style,
  connected,
  onSelectPreset,
  onLaunch,
  terminalPaneRef,
  terminalTheme,
  currentSessionLabel,
  sessionEnded,
  interruptArmed,
  onInterrupt,
  pendingTerminalOutput,
  onTerminalData,
  onTerminalResize,
  onPendingOutputFlushed,
  onClearTerminal,
  profiles,
  activeProfileId,
  onSelectProfile,
  onEditProfile,
  onCreateProfile,
  onDeleteProfile,
}: WorkspaceLeftProps) {
  const [terminalFocused, setTerminalFocused] = useState(false);
  const [terminalCopyState, setTerminalCopyState] = useState<"idle" | "copied" | "empty" | "failed">("idle");
  const [launcherCollapsedOverride, setLauncherCollapsedOverride] = useState<boolean | null>(null);
  const sessionStatusLabel = formatSessionStatusLabel(currentSessionLabel, sessionEnded);
  const launcherCollapsed = getLauncherPanelCollapsed(currentSessionLabel, launcherCollapsedOverride);

  const handleLaunch = () => {
    onLaunch();
    setLauncherCollapsedOverride(true);
  };

  const handleCopyTerminal = async () => {
    const text = terminalPaneRef.current?.getText() ?? "";
    if (!text) {
      setTerminalCopyState("empty");
      return;
    }
    setTerminalCopyState((await copyWithFallback(text)) ? "copied" : "failed");
  };

  const inputStatus = !connected
    ? "サーバー未接続（入力できません）"
    : terminalFocused
      ? "入力受付中（キーボードで直接入力できます）"
      : "ターミナル内をクリックして入力";

  return (
    <div className="workspace-column workspace-column--left">
      <LauncherPanel
        launchDraft={launchDraft}
        setLaunchDraft={setLaunchDraft}
        style={style}
        connected={connected}
        onSelectPreset={onSelectPreset}
        onLaunch={handleLaunch}
        collapsed={launcherCollapsed}
        onToggleCollapsed={() => setLauncherCollapsedOverride(!launcherCollapsed)}
        currentSessionLabel={sessionStatusLabel}
      />

      <div className="panel terminal-panel">
        <div className="terminal-panel__header">
          <div>
            <div className="terminal-panel__title">Managed Terminal</div>
            <div className="terminal-panel__hint">
              現在のセッション: {sessionStatusLabel}
            </div>
            <div
              className={`terminal-panel__input-status ${connected && terminalFocused ? "terminal-panel__input-status--active" : ""}`}
              role="status"
            >
              <span className="terminal-panel__input-dot" aria-hidden="true" />
              {inputStatus}
            </div>
          </div>
          <div className="terminal-panel__actions">
            <button
              type="button"
              className="debug-panel__btn debug-panel__btn--secondary"
              onClick={() => void handleCopyTerminal()}
              title="選択範囲があれば選択範囲、なければターミナルの表示内容をコピー"
            >
              {terminalCopyState === "copied"
                ? "コピー済み"
                : terminalCopyState === "empty"
                  ? "内容なし"
                  : terminalCopyState === "failed"
                    ? "コピー失敗"
                    : "セッションをコピー"}
            </button>
            <button
              type="button"
              className="debug-panel__btn debug-panel__btn--secondary"
              onClick={onClearTerminal}
            >
              クリア
            </button>
            <button
              type="button"
              className={`debug-panel__btn debug-panel__btn--secondary ${interruptArmed ? "debug-panel__btn--danger" : ""}`}
              onClick={onInterrupt}
              aria-label={interruptArmed ? TERMINAL_FORCE_STOP_LABEL : TERMINAL_INTERRUPT_LABEL}
              title={
                interruptArmed
                  ? `${TERMINAL_FORCE_STOP_LABEL}。CLIの終了検知やCtrl+Cが効かない場合に、このセッションの子プロセスだけを停止します。文字のコピーは「セッションをコピー」を使ってください`
                  : `${TERMINAL_INTERRUPT_LABEL}。続けてもう一度押すとセッションを強制終了します。文字のコピーは「セッションをコピー」を使ってください`
              }
            >
              {interruptArmed ? TERMINAL_FORCE_STOP_LABEL : TERMINAL_INTERRUPT_LABEL}
            </button>
          </div>
        </div>
        <Suspense
          fallback={<div className="terminal-panel__screen terminal-panel__screen--xterm" role="presentation" />}
        >
          <TerminalPane
            ref={terminalPaneRef}
            className="terminal-panel__screen terminal-panel__screen--xterm"
            onData={onTerminalData}
            onFocusChange={setTerminalFocused}
            onResize={onTerminalResize}
            onPendingOutputFlushed={onPendingOutputFlushed}
            pendingOutput={pendingTerminalOutput}
            theme={terminalTheme}
          />
        </Suspense>
      </div>

      <div className="panel workspace-subpanel">
        <ProfileSelector
          profiles={profiles}
          activeId={activeProfileId}
          disabled={!connected}
          onSelect={onSelectProfile}
          onEdit={onEditProfile}
          onCreate={onCreateProfile}
          onDelete={onDeleteProfile}
        />
        {!connected && <div className="hint-text">サーバー未接続のためプロファイル操作は無効です</div>}
      </div>
    </div>
  );
}
