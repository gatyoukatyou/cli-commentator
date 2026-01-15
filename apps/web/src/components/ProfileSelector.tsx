import type { ProfileSummary } from "../types";

type Props = {
  profiles: ProfileSummary[];
  activeId: string | null;
  disabled?: boolean;
  onSelect: (id: string | null) => void;
  onEdit: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
};

export function ProfileSelector({
  profiles,
  activeId,
  disabled = false,
  onSelect,
  onEdit,
  onCreate,
  onDelete,
}: Props) {
  const handleDelete = (id: string) => {
    if (confirm("このプロファイルを削除しますか？")) {
      onDelete(id);
    }
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <label style={{ fontSize: 14, opacity: 0.8 }}>プロファイル：</label>
      <select
        value={activeId ?? ""}
        onChange={(e) => onSelect(e.target.value || null)}
        disabled={disabled}
        style={{ minWidth: 150 }}
      >
        <option value="">（環境変数から）</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.cmd})
          </option>
        ))}
      </select>

      <button
        onClick={onCreate}
        disabled={disabled}
        style={{ padding: "4px 8px", cursor: disabled ? "not-allowed" : "pointer" }}
        title="新規作成"
      >
        ＋ 新規
      </button>

      {activeId && (
        <>
          <button
            onClick={() => onEdit(activeId)}
            disabled={disabled}
            style={{ padding: "4px 8px", cursor: disabled ? "not-allowed" : "pointer" }}
            title="編集"
          >
            編集
          </button>
          <button
            onClick={() => handleDelete(activeId)}
            disabled={disabled}
            style={{
              padding: "4px 8px",
              cursor: disabled ? "not-allowed" : "pointer",
              color: "#ef4444",
            }}
            title="削除"
          >
            削除
          </button>
        </>
      )}
    </div>
  );
}
