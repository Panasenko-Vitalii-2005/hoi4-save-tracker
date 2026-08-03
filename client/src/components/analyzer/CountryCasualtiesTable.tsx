import { memo } from "react";
import type { CountryStats } from "@/types";
import { countryFullName } from "@/lib/utils";

interface Props {
  countries: CountryStats[];
  selectedTag: string | null;
  onSelect: (tag: string) => void;
}

export const CountryCasualtiesTable = memo(function CountryCasualtiesTable({
  countries,
  selectedTag,
  onSelect,
}: Props) {
  return (
    <section className="panel war-casualties-ranking">
      <div className="panel-head">
        <h2>Country ranking</h2>
        <div className="micro-copy">{countries.length} countries</div>
      </div>
      <div className="table-wrap">
        <table className="recent-table war-casualties-table">
          <thead><tr><th>Country</th><th className="numeric-cell">Total casualties</th><th className="numeric-cell">Wars</th></tr></thead>
          <tbody>
            {countries.map((country) => (
              <tr
                key={country.tag}
                className={selectedTag === country.tag ? "selected" : ""}
                aria-selected={selectedTag === country.tag}
                onClick={() => onSelect(country.tag)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(country.tag);
                  }
                }}
              >
                <td className="country-cell"><strong>{countryFullName(country.tag)}</strong></td>
                <td className="numeric-cell">{(country.calculatedWarCasualtiesTotal ?? 0).toLocaleString()}</td>
                <td className="numeric-cell">{country.warCasualties.length.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
});
