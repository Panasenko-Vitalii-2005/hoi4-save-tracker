import { memo } from "react";
import type { CountryMilitaryProductionSummary } from "@/types";
import { countryFullName } from "@/lib/utils";
import { CountryDisplay } from "./CountryDisplay";
import { useAppTranslation } from "@/i18n";

interface Props {
  countries: CountryMilitaryProductionSummary[];
  selectedTag: string | null;
  onSelect: (tag: string) => void;
}

export const CountryProductionTable = memo(function CountryProductionTable({
  countries,
  selectedTag,
  onSelect,
}: Props) {
  const { t } = useAppTranslation();
  return (
    <section className="panel production-country-panel">
      <div className="panel-head">
        <h2>{t("production.countries")}</h2>
        <div className="micro-copy">
          {countries.length.toLocaleString()} with current production
        </div>
      </div>
      <div className="table-wrap">
        <table className="recent-table production-country-table">
          <thead>
            <tr>
              <th>{t("common.country")}</th>
              <th className="numeric-cell">{t("production.activeFactories")}</th>
              <th className="numeric-cell">{t("production.lines")}</th>
            </tr>
          </thead>
          <tbody>
            {countries.map((country) => {
              const name = countryFullName(country.countryTag);
              const selected = selectedTag === country.countryTag;
              return (
                <tr
                  key={country.countryTag}
                  className={selected ? "selected" : ""}
                  aria-selected={selected}
                  aria-label={`Inspect ${name} current military production`}
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
                    {country.activeFactories.toLocaleString()}
                  </td>
                  <td className="numeric-cell">
                    {country.lineCount.toLocaleString()}
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
