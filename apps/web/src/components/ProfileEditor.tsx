import { useState, useEffect } from "react";
import type { Profile, Style, SourceMode, ProviderName } from "../types";

type ProfileInput = {
  id?: string;
  name: string;
  cmd: string;
  args: string;
  cwd: string;
  style: Style;
  logSource: SourceMode;
  llmProvider: ProviderName | "";
};

type Props = {
  profile?: Profile | null;
  error?: string | null;
  onSave: (profile: ProfileInput) => void;
  onCancel: () => void;
};

const STYLES: { value: Style; label: string }[] = [
  { value: "standard", label: "標準" },
  { value: "kansai", label: "関西弁" },
  { value: "zundamon", label: "ずんだもん風" },
];

const LOG_SOURCES: { value: SourceMode; label: string }[] = [
  { value: "auto", label: "自動検出" },
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "generic", label: "汎用" },
];

const LLM_PROVIDERS: { value: ProviderName | ""; label: string }[] = [
  { value: "", label: "（未設定）" },
  { value: "disabled", label: "無効" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" },
  { value: "groq", label: "Groq" },
  { value: "local", label: "ローカル" },
  { value: "mock", label: "Mock（テスト）" },
];

function createEmptyInput(): ProfileInput {
  return {
    name: "",
    cmd: "bash",
    args: "",
    cwd: "",
    style: "kansai",
    logSource: "auto",
    llmProvider: "",
  };
}

function profileToInput(profile: Profile): ProfileInput {
  return {
    id: profile.id,
    name: profile.name,
    cmd: profile.cmd,
    args: profile.args.join(" "),
    cwd: profile.cwd ?? "",
    style: profile.style,
    logSource: profile.logSource,
    llmProvider: profile.llmProvider ?? "",
  };
}

export function ProfileEditor({ profile, error, onSave, onCancel }: Props) {
  const [input, setInput] = useState<ProfileInput>(createEmptyInput);

  useEffect(() => {
    if (profile) {
      setInput(profileToInput(profile));
    } else {
      setInput(createEmptyInput());
    }
  }, [profile]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.name.trim() || !input.cmd.trim()) {
      alert("名前とコマンドは必須です");
      return;
    }
    onSave(input);
  };

  const isEditing = !!profile;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal">
        <h2 className="modal__title">
          {isEditing ? "プロファイルを編集" : "新規プロファイル"}
        </h2>

        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-field__label">
              名前 <span className="form-field__required">*</span>
            </label>
            <input
              type="text"
              value={input.name}
              onChange={(e) => setInput({ ...input, name: e.target.value })}
              placeholder="例: Claude Code開発用"
              className="form-field__input"
            />
          </div>

          <div className="form-field">
            <label className="form-field__label">
              コマンド <span className="form-field__required">*</span>
            </label>
            <input
              type="text"
              value={input.cmd}
              onChange={(e) => setInput({ ...input, cmd: e.target.value })}
              placeholder="例: /bin/zsh"
              className="form-field__input"
            />
          </div>

          <div className="form-field">
            <label className="form-field__label">
              引数（スペース区切り）
            </label>
            <input
              type="text"
              value={input.args}
              onChange={(e) => setInput({ ...input, args: e.target.value })}
              placeholder="例: -l -i"
              className="form-field__input"
            />
          </div>

          <div className="form-field">
            <label className="form-field__label">
              作業ディレクトリ
            </label>
            <input
              type="text"
              value={input.cwd}
              onChange={(e) => setInput({ ...input, cwd: e.target.value })}
              placeholder="例: /home/user/project（空欄で現在のディレクトリ）"
              className="form-field__input"
            />
          </div>

          <div className="form-field">
            <label className="form-field__label">
              口調
            </label>
            <select
              value={input.style}
              onChange={(e) => setInput({ ...input, style: e.target.value as Style })}
              className="form-field__input"
            >
              {STYLES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label className="form-field__label">
              ルールセット
            </label>
            <select
              value={input.logSource}
              onChange={(e) => setInput({ ...input, logSource: e.target.value as SourceMode })}
              className="form-field__input"
            >
              {LOG_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-field" style={{ marginBottom: "var(--space-6)" }}>
            <label className="form-field__label">
              LLMプロバイダー
            </label>
            <select
              value={input.llmProvider}
              onChange={(e) => setInput({ ...input, llmProvider: e.target.value as ProviderName | "" })}
              className="form-field__input"
            >
              {LLM_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <div className="form-field__helper">
              ※ APIキーは環境変数で設定してください
            </div>
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="form-actions">
            <button
              type="button"
              onClick={onCancel}
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="btn-primary"
            >
              {isEditing ? "更新" : "作成"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
