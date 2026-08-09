import { memo } from "react";
import type { CountryNavalKillSummary } from "@/types";
import { countryFullName } from "@/lib/utils";

interface Props {
  summaries: CountryNavalKillSummary[];
  selectedTag: string | null;
  onSelect: (tag: string) => void;
}

export const CountryNavalKillTable = memo(function CountryNavalKillTable({
  summaries,
  selectedTag,
  onSelect,
}: Props) {
  return (
    <section className="panel naval-kills-ranking">
      <div className="panel-head">
        <h2>Country ranking</h2>
        <div className="micro-copy">{summaries.length} countries</div>
      </div>
      <div className="table-wrap">
        <table className="recent-table naval-kills-table">
          <thead>
            <tr>
              <th>Country</th>
              <th className="numeric-cell">Credited kills</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((summary) => {
              const selected = selectedTag === summary.countryTag;
              return (
                <tr
                  key={summary.countryTag}
                  className={selected ? "selected" : ""}
                  aria-selected={selected}
                  onClick={() => onSelect(summary.countryTag)}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(summary.countryTag);
                    }
                  }}
                >
                  <td className="country-cell">
                    <strong>{countryFullName(summary.countryTag)}</strong>
                  </td>
                  <td className="numeric-cell">
                    {summary.creditedKills.toLocaleString()}
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
