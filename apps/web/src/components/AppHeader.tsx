import type { ConnectionStatus } from "../hooks/useCommentatorSocket";

export type Skin = "standard" | "cli";

type AppHeaderProps = {
  skin: Skin;
  connectionStatus: ConnectionStatus;
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

export function AppHeader({ skin, connectionStatus, onSkinChange }: AppHeaderProps) {
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
        <span style={{ color: "var(--color-fg-secondary)" }}>
          {connectionStatus === "connected" && "接続中"}
          {connectionStatus === "connecting" && "接続しています..."}
          {connectionStatus === "reconnecting" && "再接続しています..."}
          {connectionStatus === "disconnected" && "切断"}
        </span>
      </div>
    </>
  );
}
