import { memo } from "react";
import type { CountryNavalKillSummary } from "@/types";
import { navalShipTypeLabel } from "@/lib/utils";
import { CountryDisplay } from "./CountryDisplay";
import { useAppTranslation } from "@/i18n";

export const CountryNavalKillDetails = memo(
  function CountryNavalKillDetails({
    summary,
  }: {
    summary: CountryNavalKillSummary;
  }) {
    const { t } = useAppTranslation();
    return (
      <section className="panel naval-kills-details">
        <div className="naval-kills-detail-head">
          <h2>
            <CountryDisplay tag={summary.countryTag} />
          </h2>
          <div className="naval-kills-total">
            <strong>{summary.creditedKills.toLocaleString()}</strong>
            <span>{t("naval.creditedDetail")}</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="recent-table naval-kills-table naval-kills-type-table">
            <thead>
              <tr>
                <th>{t("naval.enemyType")}</th>
                <th className="numeric-cell">{t("naval.creditedKills")}</th>
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
          {t("naval.creditedNote")}
        </p>
      </section>
    );
  },
);
