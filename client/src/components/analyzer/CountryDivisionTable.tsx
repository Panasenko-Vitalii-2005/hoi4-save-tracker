import { memo } from "react";
import type { CountryDivisionSummary } from "@/types";
import { countryFullName } from "@/lib/utils";
import { CountryDisplay } from "./CountryDisplay";

interface Props {
  countries: CountryDivisionSummary[];
  selectedTag: string | null;
  onSelect: (tag: string) => void;
}

export const CountryDivisionTable = memo(function CountryDivisionTable({
  countries,
  selectedTag,
  onSelect,
}: Props) {
  return (
    <section className="panel land-forces-country-panel">
      <div className="panel-head">
        <h2>Countries</h2>
        <div className="micro-copy">
          {countries.length.toLocaleString()} with land forces
        </div>
      </div>
      <div className="table-wrap">
        <table className="recent-table land-forces-country-table">
          <thead>
            <tr>
              <th>Country</th>
              <th className="numeric-cell">Divisions</th>
              <th className="numeric-cell">Current manpower</th>
              <th className="numeric-cell">Missing</th>
            </tr>
          </thead>
          <tbody>
            {countries.map((country) => {
              const selected = selectedTag === country.countryTag;
              const countryName = countryFullName(country.countryTag);
              return (
                <tr
                  key={country.countryTag}
                  className={selected ? "selected" : ""}
                  aria-selected={selected}
                  aria-label={`Inspect ${countryName} land forces`}
                  tabIndex={0}
                  onClick={() => onSelect(country.countryTag)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(country.countryTag);
                    }
                  }}
                >
                  <td className="country-cell">
                    <CountryDisplay tag={country.countryTag} />
                  </td>
                  <td className="numeric-cell">
                    {country.divisionCount.toLocaleString()}
                  </td>
                  <td className="numeric-cell">
                    {country.currentManpowerTotal.toLocaleString()}
                  </td>
                  <td className="numeric-cell">
                    {country.missingManpowerTotal.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
});
