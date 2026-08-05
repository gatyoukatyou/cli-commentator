import type { PtyUnavailableNotice } from "../hooks/useCommentatorSocket";
import type { AttentionNotice } from "../lib/event-notify";
import { normalizeSuggestion } from "../lib/text";

type CopyState = "idle" | "copied" | "failed";

type NoticesProps = {
  attention: AttentionNotice | null;
  onDismissAttention: () => void;
  ptyUnavailable: PtyUnavailableNotice | null;
  profileError: string | null;
  ptyError: string | null;
  copyState: CopyState;
  onCopySuggestion: () => void;
};

export function Notices({
  attention,
  onDismissAttention,
  ptyUnavailable,
  profileError,
  ptyError,
  copyState,
  onCopySuggestion,
}: NoticesProps) {
  if (!attention && !ptyUnavailable && !profileError && !ptyError) return null;

  const suggestionText = normalizeSuggestion(ptyUnavailable?.suggestion);
  const ptyUnavailableError = normalizeSuggestion(ptyUnavailable?.error);
  const attentionDetail = normalizeSuggestion(attention?.detail);
  const copyLabel = copyState === "copied" ? "Copied" : "Copy";

  return (
    <div className="notices">
      {attention && (
        <div className="notice notice--urgent panel" role="alert">
          <div className="notice__urgent-row">
            <div>
              <div className="notice__title">
                要対応：{attention.summary}
              </div>
              <div className="notice__body">
                <p>
                  CLI が入力を待っている可能性があります。左のターミナルをクリックし、
                  「入力受付中」を確認してから回答を入力し、Enter キーを押してください。
                  <span className="notice__time">
                    （{new Date(attention.ts).toLocaleTimeString()} 検出）
                  </span>
                </p>
                {attentionDetail && (
                  <pre className="notice__code">
                    <code>{attentionDetail}</code>
                  </pre>
                )}
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary notice__dismiss"
              onClick={onDismissAttention}
              aria-label="要対応の通知を閉じる"
            >
              確認した
            </button>
          </div>
        </div>
      )}
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
          <div className="notice__next-action">
            次の操作：起動設定のコマンドと作業フォルダを見直し、「セッション起動」を再実行してください。
          </div>
        </div>
      )}
      {ptyError && (
        <div className="notice notice--error panel">
          <div className="notice__title">PTYエラー</div>
          <div className="notice__body">{ptyError}</div>
          <div className="notice__next-action">
            次の操作：接続状態を確認し、左上の「セッション起動」を再実行してください。直らない場合は Desktop Server の詳細を開き、Retry Start を押してください。
          </div>
        </div>
      )}
    </div>
  );
}
