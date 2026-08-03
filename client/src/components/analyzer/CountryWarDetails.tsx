import { memo, useMemo, useState } from "react";
import type { CountryStats } from "@/types";
import { countryFullName } from "@/lib/utils";

export const CountryWarDetails = memo(function CountryWarDetails({
  country,
}: {
  country: CountryStats | null;
}) {
  const [showZeroCasualties, setShowZeroCasualties] = useState(false);
  const filteredAndSortedWars = useMemo(
    () =>
      [...(country?.warCasualties ?? [])]
        .filter((war) => showZeroCasualties || war.casualties !== 0)
        .sort((a, b) => b.casualties - a.casualties),
    [country, showZeroCasualties],
  );

  return (
    <section className="panel war-casualties-details">
      {!country ? (
        <div className="war-casualties-empty">Select a country to inspect its war casualties.</div>
      ) : (
        <>
          <div className="war-casualties-detail-head">
            <h2>{countryFullName(country.tag)}</h2>
            <div className="war-casualties-stats">
              <div><span>Calculated casualties:</span><strong>{(country.calculatedWarCasualtiesTotal ?? 0).toLocaleString()}</strong></div>
              <div><span>Wars:</span><strong>{country.warCasualties.length.toLocaleString()}</strong></div>
            </div>
          </div>
          <div className="war-casualties-controls">
            <label className="war-casualties-zero-toggle">
              <input
                type="checkbox"
                checked={showZeroCasualties}
                onChange={(event) => setShowZeroCasualties(event.target.checked)}
              />
              <span>Show zero-casualty wars</span>
            </label>
            <span className="micro-copy">
              Showing {filteredAndSortedWars.length.toLocaleString()} of{" "}
              {country.warCasualties.length.toLocaleString()} relations
            </span>
          </div>
          <div className="table-wrap">
            <table className="recent-table war-casualties-table">
              <thead><tr><th>Opponent</th><th>Start date</th><th>Role</th><th className="numeric-cell">Casualties</th></tr></thead>
              <tbody>
                {filteredAndSortedWars.map((war, index) => (
                  <tr key={`${war.opponentTag}-${war.startDate ?? "null"}-${war.role}-${index}`}>
                    <td className="country-cell"><strong>{countryFullName(war.opponentTag)}</strong></td>
                    <td className="date-cell">{war.startDate ?? ""}</td>
                    <td className="war-role">{war.role === "first" ? "First side" : "Second side"}</td>
                    <td className="numeric-cell">{war.casualties.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
});
