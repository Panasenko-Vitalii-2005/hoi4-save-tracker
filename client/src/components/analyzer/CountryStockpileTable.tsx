import { memo } from "react";
import type { CountryStockpileSummary } from "@/types";
import { countryFullName } from "@/lib/utils";
import { CountryDisplay } from "./CountryDisplay";

interface Props {
  countries: CountryStockpileSummary[];
  selectedTag: string | null;
  onSelect: (tag: string) => void;
}

export const CountryStockpileTable = memo(function CountryStockpileTable({
  countries,
  selectedTag,
  onSelect,
}: Props) {
  return (
    <section className="panel stockpile-country-panel">
      <div className="panel-head">
        <h2>Countries</h2>
        <div className="micro-copy">{countries.length} with stockpile data</div>
      </div>
      <div className="table-wrap">
        <table className="recent-table stockpile-country-table">
          <thead>
            <tr>
              <th>Country</th>
              <th className="numeric-cell">Definitions</th>
              <th className="numeric-cell">Designs</th>
            </tr>
          </thead>
          <tbody>
            {countries.map((country) => {
              const designCount = country.definitions.reduce(
                (total, definition) => total + definition.variants.length,
                0,
              );
              const countryName = countryFullName(country.countryTag);
              return (
                <tr
                  key={country.countryTag}
                  className={
                    selectedTag === country.countryTag ? "selected" : ""
                  }
                  aria-selected={selectedTag === country.countryTag}
                  aria-label={`Inspect ${countryName} stockpile`}
                  onClick={() => onSelect(country.countryTag)}
                  tabIndex={0}
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
                    {country.definitions.length.toLocaleString()}
                  </td>
                  <td className="numeric-cell">
                    {designCount.toLocaleString()}
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
