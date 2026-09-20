import { memo } from "react";
import type { CountryNavalLossSummary } from "@/types";
import { CountryDisplay } from "./CountryDisplay";
import { useAppTranslation } from "@/i18n";

interface Props {
  summaries: CountryNavalLossSummary[];
  selectedTag: string | null;
  onSelect: (tag: string | null) => void;
}

export const CountryNavalLossTable = memo(function CountryNavalLossTable({
  summaries,
  selectedTag,
  onSelect,
}: Props) {
  const { t } = useAppTranslation();
  return (
    <section className="panel naval-losses-ranking">
      <div className="panel-head">
        <h2>{t("naval.ranking")}</h2>
        <div className="micro-copy">{t("common.countriesCount", { count: summaries.length })}</div>
      </div>
      <div className="table-wrap">
        <table className="recent-table naval-losses-table">
          <thead>
            <tr>
              <th>{t("common.country")}</th>
              <th className="numeric-cell">{t("naval.shipsLost")}</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((summary) => {
              const selected = selectedTag === summary.countryTag;
              return (
                <tr
                  key={summary.countryTag ?? "unknown-country"}
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
                    <CountryDisplay tag={summary.countryTag} />
                  </td>
                  <td className="numeric-cell">
                    {summary.totalLost.toLocaleString()}
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
