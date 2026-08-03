import { useCallback, useEffect, useMemo, useState } from "react";
import type { CountryStats } from "@/types";
import { CountryCasualtiesTable } from "./CountryCasualtiesTable";
import { CountryWarDetails } from "./CountryWarDetails";

export function WarCasualtiesTab({ countries }: { countries: CountryStats[] }) {
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const sortedCountries = useMemo(
    () => countries
      .filter((country) => (country.calculatedWarCasualtiesTotal ?? 0) > 0)
      .slice()
      .sort((a, b) => (b.calculatedWarCasualtiesTotal ?? 0) - (a.calculatedWarCasualtiesTotal ?? 0)),
    [countries],
  );

  const selectedCountry = useMemo(
    () => sortedCountries.find((country) => country.tag === selectedTag) ?? null,
    [selectedTag, sortedCountries],
  );

  useEffect(() => {
    if (selectedTag && sortedCountries.some((country) => country.tag === selectedTag)) {
      return;
    }
    setSelectedTag(sortedCountries[0]?.tag ?? null);
  }, [selectedTag, sortedCountries]);

  const handleSelect = useCallback((tag: string) => setSelectedTag(tag), []);

  return (
    <>
      <div className="war-casualties-layout">
        <CountryCasualtiesTable countries={sortedCountries} selectedTag={selectedTag} onSelect={handleSelect} />
        <CountryWarDetails country={selectedCountry} />
      </div>
      <footer className="war-casualties-note">
        <strong>Calculated value.</strong>
        <span>This number is the sum of bilateral war_relation records extracted from the save file.</span>
      </footer>
    </>
  );
}
