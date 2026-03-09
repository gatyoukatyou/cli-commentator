import { useState } from "react";
import type { Profile, Style, SourceMode, InputMode, ProviderName } from "../types";

type ProfileInput = {
  id?: string;
  name: string;
  cmd: string;
  args: string;
  cwd: string;
  style: Style;
  logSource: SourceMode;
  inputMode: InputMode;
  inputFile: string;
  llmProvider: ProviderName | "";
};

type Props = {
  profile?: Profile | null;
  error?: string | null;
  isWsOpen?: boolean;
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

const INPUT_MODES: { value: InputMode; label: string }[] = [
  { value: "pty", label: "PTY（コマンド起動）" },
  { value: "file", label: "File（ログ監視）" },
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
    inputMode: "pty",
    inputFile: "",
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
    inputMode: profile.inputMode ?? "pty",
    inputFile: profile.inputFile ?? "",
    llmProvider: profile.llmProvider ?? "",
  };
}

function normalizeInput(input: ProfileInput): ProfileInput {
  return {
    ...input,
    name: input.name.trim(),
    cmd: input.cmd.trim(),
    args: input.args.trim(),
    cwd: input.cwd.trim(),
    inputFile: input.inputFile.trim(),
  };
}

export function ProfileEditor({ profile, error, isWsOpen = true, onSave, onCancel }: Props) {
  const [input, setInput] = useState<ProfileInput>(() => (profile ? profileToInput(profile) : createEmptyInput()));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeInput(input);
    if (!normalized.name) {
      alert("名前は必須です");
      return;
    }
    if (normalized.inputMode === "pty" && !normalized.cmd) {
      alert("PTYモードではコマンドが必須です");
      return;
    }
    if (normalized.inputMode === "file" && !normalized.inputFile) {
      alert("Fileモードではログファイルが必須です");
      return;
    }
    onSave(normalized);
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
              入力モード
            </label>
            <select
              value={input.inputMode}
              onChange={(e) => setInput({ ...input, inputMode: e.target.value as InputMode })}
              className="form-field__input"
            >
              {INPUT_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>

          {input.inputMode === "pty" ? (
            <>
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
            </>
          ) : (
            <div className="form-field">
              <label className="form-field__label">
                ログファイル <span className="form-field__required">*</span>
              </label>
              <input
                type="text"
                value={input.inputFile}
                onChange={(e) => setInput({ ...input, inputFile: e.target.value })}
                placeholder="例: /Users/home/project/.codex/cli-commentator-log/codex-tui.log"
                className="form-field__input"
              />
              <div className="form-field__helper">
                Fileモードでは指定したログファイルを監視します。
              </div>
            </div>
          )}

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
              disabled={!isWsOpen}
            >
              {isEditing ? "更新" : "作成"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
