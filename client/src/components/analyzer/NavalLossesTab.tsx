import { useEffect, useMemo } from "react";
import type { CountryNavalLossSummary } from "@/types";
import { CountryNavalLossDetails } from "./CountryNavalLossDetails";
import { CountryNavalLossTable } from "./CountryNavalLossTable";

export function NavalLossesTab({
  summaries,
  selectedTag,
  onSelect,
}: {
  summaries: CountryNavalLossSummary[];
  selectedTag: string | null | undefined;
  onSelect: (tag: string | null | undefined) => void;
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

  useEffect(() => {
    if (resolvedSelectedTag !== selectedTag) {
      onSelect(resolvedSelectedTag);
    }
  }, [onSelect, resolvedSelectedTag, selectedTag]);

  if (summaries.length === 0) {
    return (
      <section className="panel naval-losses-empty">
        No detailed naval losses were found in this save.
      </section>
    );
  }

  return (
    <div className="naval-losses-layout">
      <CountryNavalLossTable
        summaries={summaries}
        selectedTag={resolvedSelectedTag ?? null}
        onSelect={onSelect}
      />
      <CountryNavalLossDetails summary={selectedCountry} />
    </div>
  );
}
