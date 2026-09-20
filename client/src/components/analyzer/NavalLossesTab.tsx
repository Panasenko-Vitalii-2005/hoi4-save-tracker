import { useEffect, useMemo, useState } from "react";
import type {
  CountryNavalKillSummary,
  CountryNavalLossSummary,
  NavalKillerShipSummary,
  NavalLossEvent,
} from "@/types";
import { CountryNavalLossDetails } from "./CountryNavalLossDetails";
import { CountryNavalLossEvents } from "./CountryNavalLossEvents";
import { CountryNavalLossTable } from "./CountryNavalLossTable";
import { NavalKillsView } from "./NavalKillsView";
import { useAppTranslation } from "@/i18n";

export function NavalLossesTab({
  summaries,
  events,
  selectedTag,
  onSelect,
  killSummaries,
  killerShips,
  selectedKillTag,
  onSelectKill,
}: {
  summaries: CountryNavalLossSummary[];
  events: NavalLossEvent[];
  selectedTag: string | null | undefined;
  onSelect: (tag: string | null | undefined) => void;
  killSummaries: CountryNavalKillSummary[];
  killerShips: NavalKillerShipSummary[];
  selectedKillTag: string | undefined;
  onSelectKill: (tag: string | undefined) => void;
}) {
  const { t } = useAppTranslation();
  const [mode, setMode] = useState<"losses" | "kills">("losses");

  const resolvedSelectedTag = useMemo(
    () =>
      selectedTag !== undefined &&
      summaries.some((summary) => summary.countryTag === selectedTag)
        ? selectedTag
        : summaries[0]?.countryTag,
    [selectedTag, summaries],
  );

  const selectedCountry = useMemo(
    () =>
      summaries.find((summary) => summary.countryTag === resolvedSelectedTag) ??
      null,
    [resolvedSelectedTag, summaries],
  );

  useEffect(() => {
    if (resolvedSelectedTag !== selectedTag) {
      onSelect(resolvedSelectedTag);
    }
  }, [onSelect, resolvedSelectedTag, selectedTag]);

  return (
    <>
      <div
        className="tab-bar naval-analysis-mode-tabs"
        role="tablist"
        aria-label="Naval loss analysis mode"
      >
        <button
          className={`tab-btn${mode === "losses" ? " active" : ""}`}
          type="button"
          role="tab"
          aria-selected={mode === "losses"}
          onClick={() => setMode("losses")}
        >
          {t("naval.losses")}
        </button>
        <button
          className={`tab-btn${mode === "kills" ? " active" : ""}`}
          type="button"
          role="tab"
          aria-selected={mode === "kills"}
          onClick={() => setMode("kills")}
        >
          {t("naval.kills")}
        </button>
      </div>

      {mode === "kills" ? (
        <NavalKillsView
          summaries={killSummaries}
          killerShips={killerShips}
          selectedTag={selectedKillTag}
          onSelect={onSelectKill}
        />
      ) : summaries.length === 0 ? (
        <section className="panel naval-losses-empty">
          {t("naval.noLosses")}
        </section>
      ) : (
        <div className="naval-losses-layout">
          <CountryNavalLossTable
            summaries={summaries}
            selectedTag={resolvedSelectedTag ?? null}
            onSelect={onSelect}
          />
          <div className="naval-losses-detail-column">
            <CountryNavalLossDetails summary={selectedCountry} />
            {selectedCountry && (
              <CountryNavalLossEvents
                summary={selectedCountry}
                events={events}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
