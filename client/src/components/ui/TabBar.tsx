import type { TabId } from "@/types";
import { useAppTranslation } from "@/i18n";

const TABS: { id: TabId; labelKey: "nav.campaignTrends" | "nav.saveAnalyzer" }[] = [
  { id: "chart", labelKey: "nav.campaignTrends" },
  { id: "analyzer", labelKey: "nav.saveAnalyzer" },
];

export function TabBar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (t: TabId) => void;
}) {
  const { t } = useAppTranslation();
  return (
    <div className="tab-bar">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`tab-btn${active === tab.id ? " active" : ""}`}
          aria-current={active === tab.id ? "page" : undefined}
          onClick={() => onChange(tab.id)}
        >
          {t(tab.labelKey)}
        </button>
      ))}
    </div>
  );
}
