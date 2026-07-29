import type { ConnectionStatus } from "../hooks/useCommentatorSocket";
import type { DesktopServerState } from "./recovery";

export type ConnectionGuidance = {
  /** ヘッダーに出す短いラベル。 */
  label: string;
  /** 次に何をすればよいか。何もすることがなければ null。 */
  hint: string | null;
};

export type ConnectionGuidanceInput = {
  connectionStatus: ConnectionStatus;
  /** Desktop（Tauri）で動いているか。false なら Web UI 単体。 */
  isDesktopRuntime: boolean;
  /** Desktop Server パネルが報告する状態。未取得なら null。 */
  desktopServerState: DesktopServerState | null;
};

const WEB_STANDALONE_HINT =
  "サーバーが起動していません。別のターミナルで `pnpm dev:server` を実行してください（`pnpm dev` ならサーバーとWeb UIを同時に起動します）。";

/**
 * 接続状態を、そのまま画面に出せるラベルと次の一手に変換する。
 *
 * 「切断」とだけ出すと、Web UI単体で起動しているのか、Desktop managed で
 * まだ Start を押していないのかが利用者に区別できない。実行環境と
 * Desktop Server の状態まで見て、理由と次の一手を出し分ける。
 */
export function getConnectionGuidance({
  connectionStatus,
  isDesktopRuntime,
  desktopServerState,
}: ConnectionGuidanceInput): ConnectionGuidance {
  if (connectionStatus === "connected") {
    return { label: "接続中", hint: null };
  }

  if (connectionStatus === "connecting") {
    return { label: "接続しています...", hint: null };
  }

  if (connectionStatus === "reconnecting") {
    return {
      label: "再接続しています...",
      hint: "サーバーとの通信が切れました。自動で再接続を試しています。",
    };
  }

  if (!isDesktopRuntime) {
    return { label: "切断（サーバー未接続）", hint: WEB_STANDALONE_HINT };
  }

  switch (desktopServerState) {
    case "starting":
      return {
        label: "サーバーの起動を待っています",
        hint: "Desktop Server パネルの状態が running になるまで待ってください。",
      };
    case "stopping":
      return { label: "サーバーを停止しています", hint: null };
    case "failed":
      return {
        label: "切断（サーバーの起動に失敗）",
        hint: "Desktop Server パネルの復旧カードに表示されたコマンドを、上から順に確認してください。",
      };
    case "running":
      // サーバーは動いているのに繋がらない = ポート不一致の可能性が高い。
      return {
        label: "切断（サーバーは動作中）",
        hint: "サーバーは running です。接続先ポートがずれている可能性があるため、Desktop Server パネルに表示されているポートを確認してください。",
      };
    case "stopped":
    default:
      return {
        label: "切断（サーバー停止中）",
        hint: "Desktop Server パネルの Start を押してサーバーを起動してください。",
      };
  }
}
