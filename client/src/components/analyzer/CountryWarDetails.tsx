import { memo, useMemo, useState } from "react";
import type { CountryStats } from "@/types";
import { CountryDisplay } from "./CountryDisplay";
import { useAppTranslation } from "@/i18n";

export const CountryWarDetails = memo(function CountryWarDetails({
  country,
}: {
  country: CountryStats | null;
}) {
  const { t } = useAppTranslation();
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
        <div className="war-casualties-empty">{t("casualties.select")}</div>
      ) : (
        <>
          <div className="war-casualties-detail-head">
            <h2>
              <CountryDisplay tag={country.tag} />
            </h2>
            <div className="war-casualties-stats">
              <div><span>{t("casualties.calculated")}</span><strong>{(country.calculatedWarCasualtiesTotal ?? 0).toLocaleString()}</strong></div>
              <div><span>{t("casualties.wars")}:</span><strong>{country.warCasualties.length.toLocaleString()}</strong></div>
            </div>
          </div>
          <div className="war-casualties-controls">
            <label className="war-casualties-zero-toggle">
              <input
                type="checkbox"
                checked={showZeroCasualties}
                onChange={(event) => setShowZeroCasualties(event.target.checked)}
              />
              <span>{t("casualties.showZero")}</span>
            </label>
            <span className="micro-copy">
              {t("casualties.showing", { shown: filteredAndSortedWars.length.toLocaleString(), total: country.warCasualties.length.toLocaleString() })}
            </span>
          </div>
          <div className="table-wrap">
            <table className="recent-table war-casualties-table">
              <thead><tr><th>{t("casualties.opponent")}</th><th>{t("casualties.startDate")}</th><th className="numeric-cell">{t("casualties.casualties")}</th></tr></thead>
              <tbody>
                {filteredAndSortedWars.map((war, index) => (
                  <tr key={`${war.opponentTag}-${war.startDate ?? "null"}-${index}`}>
                    <td className="country-cell">
                      <CountryDisplay tag={war.opponentTag} />
                    </td>
                    <td className="date-cell">{war.startDate ?? ""}</td>
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
