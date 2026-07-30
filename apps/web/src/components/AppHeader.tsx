import type { ConnectionStatus } from "../hooks/useCommentatorSocket";
import { getConnectionGuidance } from "../lib/connection-guidance";
import type { DesktopServerState } from "../lib/recovery";

export type Skin = "standard" | "cli";

type AppHeaderProps = {
  skin: Skin;
  connectionStatus: ConnectionStatus;
  isDesktopRuntime: boolean;
  desktopServerState: DesktopServerState | null;
  onSkinChange: (skin: Skin) => void;
};

function getStatusIndicatorClass(connectionStatus: ConnectionStatus): string {
  switch (connectionStatus) {
    case "connected":
      return "status-indicator status-indicator--connected";
    case "connecting":
    case "reconnecting":
      return "status-indicator status-indicator--connecting";
    default:
      return "status-indicator status-indicator--disconnected";
  }
}

export function AppHeader({
  skin,
  connectionStatus,
  isDesktopRuntime,
  desktopServerState,
  onSkinChange,
}: AppHeaderProps) {
  const guidance = getConnectionGuidance({
    connectionStatus,
    isDesktopRuntime,
    desktopServerState,
  });

  return (
    <>
      <h1>CLI 実況（MVP）</h1>

      <div className="skin-selector">
        <span className="skin-selector__label">スキン：</span>
        <select value={skin} onChange={(e) => onSkinChange(e.target.value as Skin)}>
          <option value="standard">Standard</option>
          <option value="cli">CLI</option>
        </select>
      </div>

      <div className="control-row" style={{ fontSize: "var(--text-sm)" }}>
        <span className={getStatusIndicatorClass(connectionStatus)} />
        <span style={{ color: "var(--color-fg-secondary)" }}>{guidance.label}</span>
      </div>

      {guidance.hint && (
        <p className="connection-hint" role="status">
          {guidance.hint}
        </p>
      )}
    </>
  );
}
