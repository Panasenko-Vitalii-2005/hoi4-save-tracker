import { memo } from "react";
import type { CountryStats } from "@/types";
import { CountryDisplay } from "./CountryDisplay";
import { useAppTranslation } from "@/i18n";

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
  const { t } = useAppTranslation();
  return (
    <section className="panel war-casualties-ranking">
      <div className="panel-head">
        <h2>{t("casualties.ranking")}</h2>
        <div className="micro-copy">{t("common.countriesCount", { count: countries.length })}</div>
      </div>
      <div className="table-wrap">
        <table className="recent-table war-casualties-table">
          <thead><tr><th>{t("common.country")}</th><th className="numeric-cell">{t("casualties.total")}</th><th className="numeric-cell">{t("casualties.wars")}</th></tr></thead>
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
                <td className="country-cell">
                  <CountryDisplay tag={country.tag} />
                </td>
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
