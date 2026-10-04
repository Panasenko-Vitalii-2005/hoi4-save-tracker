import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
  CountryEconomyComparison,
  NumericDiff,
} from "@/types/analysis-comparison";
import { ECONOMY_LEDGER_METRICS } from "@/types/economy";
import { ECONOMY_METRIC_LABEL_KEYS } from "@/lib/economy-metrics";
import { formatEconomyNumber, rawEconomyValue } from "@/lib/economy-display";
import { appLocale } from "@/i18n";
import { CountryDisplay } from "./CountryDisplay";
import "./EconomyComparisonPanel.css";

function Value({ value }: { value: number | null }) {
  return (
    <span title={rawEconomyValue(value)}>
      {formatEconomyNumber(value, appLocale())}
    </span>
  );
}

export function EconomyComparisonPanel({
  countryTag,
  comparison,
  renderDelta,
}: {
  countryTag: string | null;
  comparison: CountryEconomyComparison | null;
  renderDelta: (diff: NumericDiff) => ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section
      className="comparison-equipment-panel"
      aria-label={t("economy.title")}
    >
      <div className="comparison-section-heading">
        <h3>
          {t("economy.title")}
          {countryTag && (
            <>
              {" "}
              · <CountryDisplay tag={countryTag} />
            </>
          )}
        </h3>
      </div>
      <p className="micro-copy">{t("economy.serializedNote")}</p>
      {!comparison ? (
        <p className="micro-copy">
          {t(
            countryTag ? "economy.unavailable" : "compare.selectCountryChanges",
          )}
        </p>
      ) : (
        <div className="economy-comparison-resources">
          {comparison.resources.map((row) => (
            <details
              key={row.resource}
              className="comparison-detail economy-comparison-resource"
            >
              <summary>
                {t(`economy.resources.${row.resource}`)} ·{" "}
                {t("economy.balance")}:{" "}
                <Value value={row.serializedBalance.before} /> →{" "}
                <Value value={row.serializedBalance.after} /> ·{" "}
                {renderDelta(row.serializedBalance)}
              </summary>
              <div className="table-wrap">
                <table className="comparison-detail-table">
                  <thead>
                    <tr>
                      <th>{t("compare.metric")}</th>
                      <th>{t("compare.base")}</th>
                      <th>{t("compare.target")}</th>
                      <th>{t("compare.change")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ECONOMY_LEDGER_METRICS.map((metric) => {
                      const diff: NumericDiff = row[metric];
                      return (
                        <tr key={metric}>
                          <th scope="row">
                            {t(ECONOMY_METRIC_LABEL_KEYS[metric])}
                          </th>
                          <td>
                            <Value value={diff.before} />
                          </td>
                          <td>
                            <Value value={diff.after} />
                          </td>
                          <td>{renderDelta(diff)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
