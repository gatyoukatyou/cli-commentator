import type { PtyUnavailableNotice } from "../hooks/useCommentatorSocket";
import { normalizeSuggestion } from "../lib/text";

type CopyState = "idle" | "copied" | "failed";

type NoticesProps = {
  ptyUnavailable: PtyUnavailableNotice | null;
  profileError: string | null;
  ptyError: string | null;
  copyState: CopyState;
  onCopySuggestion: () => void;
};

export function Notices({
  ptyUnavailable,
  profileError,
  ptyError,
  copyState,
  onCopySuggestion,
}: NoticesProps) {
  if (!ptyUnavailable && !profileError && !ptyError) return null;

  const suggestionText = normalizeSuggestion(ptyUnavailable?.suggestion);
  const ptyUnavailableError = normalizeSuggestion(ptyUnavailable?.error);
  const copyLabel = copyState === "copied" ? "Copied" : "Copy";

  return (
    <div className="notices">
      {ptyUnavailable && (
        <div className="notice notice--warning panel">
          <div className="notice__title">PTYが利用できません</div>
          <div className="notice__body">
            <p>PTYが利用できないため、fileモードで起動してください。</p>
            {ptyUnavailableError && <p className="notice__hint">{ptyUnavailableError}</p>}
            {suggestionText ? (
              <div className="notice__code-row">
                <pre className="notice__code">
                  <code>{suggestionText}</code>
                </pre>
                <div className="notice__actions">
                  <button type="button" className="btn-secondary notice__copy" onClick={onCopySuggestion}>
                    {copyLabel}
                  </button>
                  {copyState === "failed" && (
                    <span className="notice__copy-hint">コピーできませんでした。手動で選択してください。</span>
                  )}
                </div>
              </div>
            ) : (
              <p className="notice__hint">
                <code>INPUT_MODE=file</code> でログファイルを指定して起動できます。
              </p>
            )}
          </div>
        </div>
      )}
      {profileError && (
        <div className="notice notice--error panel">
          <div className="notice__title">プロファイルエラー</div>
          <div className="notice__body">{profileError}</div>
        </div>
      )}
      {ptyError && (
        <div className="notice notice--error panel">
          <div className="notice__title">PTYエラー</div>
          <div className="notice__body">{ptyError}</div>
        </div>
      )}
    </div>
  );
}
