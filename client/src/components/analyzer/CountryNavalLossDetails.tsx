import { memo } from "react";
import type { CountryNavalLossSummary } from "@/types";
import { navalShipTypeLabel } from "@/lib/utils";
import { CountryDisplay } from "./CountryDisplay";
import { useAppTranslation } from "@/i18n";

export const CountryNavalLossDetails = memo(function CountryNavalLossDetails({
  summary,
}: {
  summary: CountryNavalLossSummary | null;
}) {
  const { t } = useAppTranslation();
  return (
    <section className="panel naval-losses-details">
      {!summary ? (
        <div className="naval-losses-empty">
          {t("naval.selectLoss")}
        </div>
      ) : (
        <>
          <div className="naval-losses-detail-head">
            <h2>
              <CountryDisplay tag={summary.countryTag} />
            </h2>
            <div className="naval-losses-total">
              <strong>{summary.totalLost.toLocaleString()}</strong>
              <span>{t("naval.recoverable")}</span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="recent-table naval-losses-table naval-losses-type-table">
              <thead>
                <tr>
                  <th>{t("naval.type")}</th>
                  <th className="numeric-cell">{t("naval.shipsLost")}</th>
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
            {t("naval.recoverableNote")}
          </p>
        </>
      )}
    </section>
  );
});
