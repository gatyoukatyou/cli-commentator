import { Suspense, lazy } from "react";
import type { Profile } from "../types";
import type { ProfileSaveInput } from "../hooks/useProfileActions";

const ProfileEditor = lazy(() =>
  import("./ProfileEditor").then((module) => ({
    default: module.ProfileEditor,
  }))
);

type ProfileEditorModalProps = {
  editingProfile: Profile | null | "new" | "loading";
  error: string | null;
  connected: boolean;
  onSave: (input: ProfileSaveInput) => void;
  onCancel: () => void;
};

export function ProfileEditorModal({
  editingProfile,
  error,
  connected,
  onSave,
  onCancel,
}: ProfileEditorModalProps) {
  const profileEditorKey =
    editingProfile === "new"
      ? "profile-new"
      : editingProfile && editingProfile !== "loading"
        ? `profile-${editingProfile.id}`
        : "profile-empty";

  return (
    <>
      {editingProfile === "loading" && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2 className="modal__title">プロファイルを読み込み中...</h2>
            <div className="form-actions">
              <button type="button" onClick={onCancel}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
      {editingProfile && editingProfile !== "loading" && (
        <Suspense
          fallback={
            <div className="modal-backdrop">
              <div className="modal">
                <h2 className="modal__title">プロファイルエディターを読み込み中...</h2>
                <div className="form-actions">
                  <button type="button" onClick={onCancel}>
                    キャンセル
                  </button>
                </div>
              </div>
            </div>
          }
        >
          <ProfileEditor
            key={profileEditorKey}
            profile={editingProfile === "new" ? null : editingProfile}
            error={error}
            isWsOpen={connected}
            onSave={onSave}
            onCancel={onCancel}
          />
        </Suspense>
      )}
    </>
  );
}
