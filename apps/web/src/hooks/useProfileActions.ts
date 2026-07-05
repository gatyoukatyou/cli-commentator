import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { CreateProfileInput, InputMode, Profile, SourceState, Style } from "../types";

type EditingProfile = Profile | null | "new" | "loading";

export type ProfileSaveInput = {
  id?: string;
  name: string;
  cmd: string;
  args: string;
  cwd: string;
  style: Style;
  logSource: SourceState["mode"];
  inputMode: InputMode;
  inputFile: string;
  narrationProvider: string;
  explanationProvider: string;
};

type UseProfileActionsOptions = {
  wsRef: RefObject<WebSocket | null>;
  pendingEditIdRef: RefObject<string | null>;
  setEditingProfile: Dispatch<SetStateAction<EditingProfile>>;
  setProfileError: Dispatch<SetStateAction<string | null>>;
};

export function useProfileActions({
  wsRef,
  pendingEditIdRef,
  setEditingProfile,
  setProfileError,
}: UseProfileActionsOptions) {
  const requireSocket = useCallback(
    (message: string): WebSocket | null => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return wsRef.current;
      setProfileError(message);
      return null;
    },
    [setProfileError, wsRef]
  );

  const handleSelectProfile = useCallback(
    (id: string | null) => {
      setProfileError(null);
      requireSocket("サーバーに接続されていません")?.send(
        JSON.stringify({ kind: "setActiveProfile", id })
      );
    },
    [requireSocket, setProfileError]
  );

  const handleEditProfile = useCallback(
    (id: string) => {
      setProfileError(null);
      const socket = requireSocket("サーバーに接続されていません");
      if (!socket) return;
      pendingEditIdRef.current = id;
      setEditingProfile("loading");
      socket.send(JSON.stringify({ kind: "getProfile", id }));
    },
    [pendingEditIdRef, requireSocket, setEditingProfile, setProfileError]
  );

  const handleCreateProfile = useCallback(() => {
    setEditingProfile("new");
    setProfileError(null);
  }, [setEditingProfile, setProfileError]);

  const handleDeleteProfile = useCallback(
    (id: string) => {
      setProfileError(null);
      requireSocket("サーバーに接続されていません")?.send(
        JSON.stringify({ kind: "deleteProfile", id })
      );
    },
    [requireSocket, setProfileError]
  );

  const handleSaveProfile = useCallback(
    (input: ProfileSaveInput) => {
      setProfileError(null);
      const socket = requireSocket("サーバーに接続されていません。再接続を待ってください。");
      if (!socket) return;

      const normalizedName = input.name.trim();
      const normalizedCmd = input.cmd.trim();
      const normalizedCwd = input.cwd.trim();
      const normalizedInputFile = input.inputFile.trim();
      const profile: CreateProfileInput & { id?: string } = {
        id: input.id,
        name: normalizedName,
        cmd: normalizedCmd || (input.inputMode === "file" ? "file" : normalizedCmd),
        args: input.args.trim().split(/\s+/).filter(Boolean),
        cwd: normalizedCwd || undefined,
        style: input.style,
        logSource: input.logSource,
        inputMode: input.inputMode,
        inputFile: normalizedInputFile || undefined,
        narrationProvider: input.narrationProvider
          ? (input.narrationProvider as CreateProfileInput["narrationProvider"])
          : ("" as CreateProfileInput["narrationProvider"]),
        explanationProvider: input.explanationProvider
          ? (input.explanationProvider as CreateProfileInput["explanationProvider"])
          : ("" as CreateProfileInput["explanationProvider"]),
      };
      socket.send(JSON.stringify({ kind: "saveProfile", profile }));
    },
    [requireSocket, setProfileError]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingProfile(null);
    setProfileError(null);
    pendingEditIdRef.current = null;
  }, [pendingEditIdRef, setEditingProfile, setProfileError]);

  return {
    handleSelectProfile,
    handleEditProfile,
    handleCreateProfile,
    handleDeleteProfile,
    handleSaveProfile,
    handleCancelEdit,
  };
}
