import type { TabId } from "@/types";

const TABS: { id: TabId; label: string }[] = [
  { id: "chart", label: "Chart" },
  { id: "soldiers", label: "Soldiers by Country" },
  { id: "analyzer", label: "Save Analyzer" },
];

export function TabBar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (t: TabId) => void;
}) {
  return (
    <div className="tab-bar">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`tab-btn${active === t.id ? " active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
