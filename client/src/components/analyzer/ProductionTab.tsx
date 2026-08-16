import { useCallback, useEffect, useMemo } from "react";
import type { CountryMilitaryProductionSummary } from "@/types";
import { CountryProductionDetails } from "./CountryProductionDetails";
import { CountryProductionTable } from "./CountryProductionTable";

export function ProductionTab({
  summaries,
  selectedTag,
  selectedDefinitionName,
  onSelectedTagChange,
  onSelectedDefinitionChange,
}: {
  summaries: CountryMilitaryProductionSummary[];
  selectedTag: string | null;
  selectedDefinitionName: string | null;
  onSelectedTagChange: (tag: string | null) => void;
  onSelectedDefinitionChange: (definition: string | null) => void;
}) {
  const selectedCountry = useMemo(
    () =>
      summaries.find((country) => country.countryTag === selectedTag) ?? null,
    [selectedTag, summaries],
  );

  const selectedDefinition = useMemo(
    () =>
      selectedCountry?.definitions.find(
        (definition) =>
          definition.equipmentDefinition === selectedDefinitionName,
      ) ?? null,
    [selectedCountry, selectedDefinitionName],
  );

  useEffect(() => {
    if (
      selectedTag &&
      summaries.some((country) => country.countryTag === selectedTag)
    ) {
      return;
    }
    onSelectedTagChange(summaries[0]?.countryTag ?? null);
  }, [onSelectedTagChange, selectedTag, summaries]);

  useEffect(() => {
    if (
      selectedDefinitionName &&
      selectedCountry?.definitions.some(
        (definition) =>
          definition.equipmentDefinition === selectedDefinitionName,
      )
    ) {
      return;
    }
    onSelectedDefinitionChange(
      selectedCountry?.definitions[0]?.equipmentDefinition ?? null,
    );
  }, [onSelectedDefinitionChange, selectedCountry, selectedDefinitionName]);

  const handleCountrySelect = useCallback(
    (tag: string) => {
      const country = summaries.find((summary) => summary.countryTag === tag);
      onSelectedTagChange(tag);
      onSelectedDefinitionChange(
        country?.definitions[0]?.equipmentDefinition ?? null,
      );
    },
    [onSelectedDefinitionChange, onSelectedTagChange, summaries],
  );

  const handleDefinitionSelect = useCallback(
    (definition: string) => {
      onSelectedDefinitionChange(definition);
    },
    [onSelectedDefinitionChange],
  );

  if (summaries.length === 0) {
    return (
      <section className="panel production-empty production-empty-save">
        No current military production lines were found in this save.
      </section>
    );
  }

  return (
    <>
      <div className="production-layout">
        <CountryProductionTable
          countries={summaries}
          selectedTag={selectedTag}
          onSelect={handleCountrySelect}
        />
        <CountryProductionDetails
          country={selectedCountry}
          selectedDefinition={selectedDefinition}
          onSelectDefinition={handleDefinitionSelect}
        />
      </div>
      <footer className="production-note">
        <strong>Current military production snapshot.</strong>
        <span>
          Land and air production lines only; rates are current estimates from
          this save and do not represent production history or factory
          ownership.
        </span>
      </footer>
    </>
  );
}
