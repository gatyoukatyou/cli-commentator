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

export function ProfileEditor({ profile, onSave, onCancel }: Props) {
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
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: 8,
          padding: 24,
          width: 480,
          maxWidth: "90vw",
          maxHeight: "90vh",
          overflow: "auto",
        }}
      >
        <h2 style={{ margin: "0 0 16px 0" }}>
          {isEditing ? "プロファイルを編集" : "新規プロファイル"}
        </h2>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
              名前 <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              type="text"
              value={input.name}
              onChange={(e) => setInput({ ...input, name: e.target.value })}
              placeholder="例: Claude Code開発用"
              style={{ width: "100%", padding: 8, borderRadius: 4, border: "1px solid #ccc" }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
              コマンド <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              type="text"
              value={input.cmd}
              onChange={(e) => setInput({ ...input, cmd: e.target.value })}
              placeholder="例: /bin/zsh"
              style={{ width: "100%", padding: 8, borderRadius: 4, border: "1px solid #ccc" }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
              引数（スペース区切り）
            </label>
            <input
              type="text"
              value={input.args}
              onChange={(e) => setInput({ ...input, args: e.target.value })}
              placeholder="例: -l -i"
              style={{ width: "100%", padding: 8, borderRadius: 4, border: "1px solid #ccc" }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
              作業ディレクトリ
            </label>
            <input
              type="text"
              value={input.cwd}
              onChange={(e) => setInput({ ...input, cwd: e.target.value })}
              placeholder="例: /home/user/project（空欄で現在のディレクトリ）"
              style={{ width: "100%", padding: 8, borderRadius: 4, border: "1px solid #ccc" }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
              口調
            </label>
            <select
              value={input.style}
              onChange={(e) => setInput({ ...input, style: e.target.value as Style })}
              style={{ width: "100%", padding: 8, borderRadius: 4, border: "1px solid #ccc" }}
            >
              {STYLES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
              ルールセット
            </label>
            <select
              value={input.logSource}
              onChange={(e) => setInput({ ...input, logSource: e.target.value as SourceMode })}
              style={{ width: "100%", padding: 8, borderRadius: 4, border: "1px solid #ccc" }}
            >
              {LOG_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
              LLMプロバイダー
            </label>
            <select
              value={input.llmProvider}
              onChange={(e) => setInput({ ...input, llmProvider: e.target.value as ProviderName | "" })}
              style={{ width: "100%", padding: 8, borderRadius: 4, border: "1px solid #ccc" }}
            >
              {LLM_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
              ※ APIキーは環境変数で設定してください
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: "8px 16px",
                borderRadius: 4,
                border: "1px solid #ccc",
                backgroundColor: "#fff",
                cursor: "pointer",
              }}
            >
              キャンセル
            </button>
            <button
              type="submit"
              style={{
                padding: "8px 16px",
                borderRadius: 4,
                border: "none",
                backgroundColor: "#3b82f6",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              {isEditing ? "更新" : "作成"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
