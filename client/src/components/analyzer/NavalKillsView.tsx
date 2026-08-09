import { useEffect, useMemo } from "react";
import type {
  CountryNavalKillSummary,
  NavalKillerShipSummary,
} from "@/types";
import { CountryNavalKillDetails } from "./CountryNavalKillDetails";
import { CountryNavalKillTable } from "./CountryNavalKillTable";
import { NavalKillerShipsTable } from "./NavalKillerShipsTable";

export function NavalKillsView({
  summaries,
  killerShips,
  selectedTag,
  onSelect,
}: {
  summaries: CountryNavalKillSummary[];
  killerShips: NavalKillerShipSummary[];
  selectedTag: string | undefined;
  onSelect: (tag: string | undefined) => void;
}) {
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
      summaries.find(
        (summary) => summary.countryTag === resolvedSelectedTag,
      ) ?? null,
    [resolvedSelectedTag, summaries],
  );

  const selectedCountryShips = useMemo(
    () =>
      resolvedSelectedTag === undefined
        ? []
        : killerShips.filter(
            (summary) => summary.countryTag === resolvedSelectedTag,
          ),
    [killerShips, resolvedSelectedTag],
  );

  useEffect(() => {
    if (resolvedSelectedTag !== selectedTag) {
      onSelect(resolvedSelectedTag);
    }
  }, [onSelect, resolvedSelectedTag, selectedTag]);

  if (summaries.length === 0) {
    return (
      <section className="panel naval-kills-empty">
        No credited naval kills could be resolved from this save.
      </section>
    );
  }

  return (
    <div className="naval-kills-layout">
      <CountryNavalKillTable
        summaries={summaries}
        selectedTag={resolvedSelectedTag ?? null}
        onSelect={onSelect}
      />
      {selectedCountry && (
        <div className="naval-kills-detail-column">
          <CountryNavalKillDetails summary={selectedCountry} />
          <NavalKillerShipsTable ships={selectedCountryShips} />
        </div>
      )}
    </div>
  );
}
