import { memo } from "react";
import type { CountryNavalLossSummary } from "@/types";
import { countryFullName, navalShipTypeLabel } from "@/lib/utils";

function countryLabel(tag: string | null): string {
  return tag === null ? "Unknown country" : countryFullName(tag);
}

export const CountryNavalLossDetails = memo(function CountryNavalLossDetails({
  summary,
}: {
  summary: CountryNavalLossSummary | null;
}) {
  return (
    <section className="panel naval-losses-details">
      {!summary ? (
        <div className="naval-losses-empty">
          Select a country to inspect its naval losses.
        </div>
      ) : (
        <>
          <div className="naval-losses-detail-head">
            <h2>{countryLabel(summary.countryTag)}</h2>
            <div className="naval-losses-total">
              <strong>{summary.totalLost.toLocaleString()}</strong>
              <span>recoverable detailed naval losses</span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="recent-table naval-losses-table naval-losses-type-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th className="numeric-cell">Ships lost</th>
                </tr>
              </thead>
              <tbody>
                {summary.byType.map((type) => (
                  <tr key={type.definition}>
                    <td className="type-cell">
                      <strong>{navalShipTypeLabel(type.definition)}</strong>
                    </td>
                    <td className="numeric-cell">
                      {type.count.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="naval-losses-note">
            Detailed naval losses recoverable from the current save.
          </p>
        </>
      )}
    </section>
  );
});
