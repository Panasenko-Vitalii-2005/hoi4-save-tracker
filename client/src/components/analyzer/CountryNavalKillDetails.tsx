import { memo } from "react";
import type { CountryNavalKillSummary } from "@/types";
import { navalShipTypeLabel } from "@/lib/utils";
import { CountryDisplay } from "./CountryDisplay";

export const CountryNavalKillDetails = memo(
  function CountryNavalKillDetails({
    summary,
  }: {
    summary: CountryNavalKillSummary;
  }) {
    return (
      <section className="panel naval-kills-details">
        <div className="naval-kills-detail-head">
          <h2>
            <CountryDisplay tag={summary.countryTag} />
          </h2>
          <div className="naval-kills-total">
            <strong>{summary.creditedKills.toLocaleString()}</strong>
            <span>credited naval kills found in detailed save records</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="recent-table naval-kills-table naval-kills-type-table">
            <thead>
              <tr>
                <th>Enemy ship type</th>
                <th className="numeric-cell">Credited kills</th>
              </tr>
            </thead>
            <tbody>
              {summary.byVictimType.map((type) => (
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
        <p className="naval-kills-note">
          Only sinkings with resolvable credited-killer attribution are counted.
        </p>
      </section>
    );
  },
);
