import { useCallback, useEffect, useMemo, useState } from "react";
import type { CountryStockpileSummary } from "@/types";
import { CountryStockpileDetails } from "./CountryStockpileDetails";
import { CountryStockpileTable } from "./CountryStockpileTable";

export function StockpileTab({
  summaries,
}: {
  summaries: CountryStockpileSummary[];
}) {
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedDefinitionName, setSelectedDefinitionName] = useState<
    string | null
  >(null);

  const selectedCountry = useMemo(
    () =>
      summaries.find((country) => country.countryTag === selectedTag) ?? null,
    [selectedTag, summaries],
  );

  const selectedDefinition = useMemo(
    () =>
      selectedCountry?.definitions.find(
        (definition) => definition.definition === selectedDefinitionName,
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
    setSelectedTag(summaries[0]?.countryTag ?? null);
  }, [selectedTag, summaries]);

  useEffect(() => {
    if (
      selectedDefinitionName &&
      selectedCountry?.definitions.some(
        (definition) => definition.definition === selectedDefinitionName,
      )
    ) {
      return;
    }
    setSelectedDefinitionName(
      selectedCountry?.definitions[0]?.definition ?? null,
    );
  }, [selectedCountry, selectedDefinitionName]);

  const handleCountrySelect = useCallback((tag: string) => {
    setSelectedTag(tag);
  }, []);
  const handleDefinitionSelect = useCallback((definition: string) => {
    setSelectedDefinitionName(definition);
  }, []);

  if (summaries.length === 0) {
    return (
      <section className="panel stockpile-empty stockpile-empty-save">
        No national stockpile data was found in this save.
      </section>
    );
  }

  return (
    <>
      <div className="stockpile-layout">
        <CountryStockpileTable
          countries={summaries}
          selectedTag={selectedTag}
          onSelect={handleCountrySelect}
        />
        <CountryStockpileDetails
          country={selectedCountry}
          selectedDefinition={selectedDefinition}
          onSelectDefinition={handleDefinitionSelect}
        />
      </div>
      <footer className="stockpile-note">
        <strong>National stockpile balances.</strong>
        <span>
          Values may be fractional or negative because HOI4 stores internal
          equipment accounting as signed decimals.
        </span>
      </footer>
    </>
  );
}
