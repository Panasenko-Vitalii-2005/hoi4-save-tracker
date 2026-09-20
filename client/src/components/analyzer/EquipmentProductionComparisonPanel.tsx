import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type {
  CountryEquipmentProductionComparison,
  EquipmentDefinitionComparison,
  NumericDiff,
  ProductionRateComparison,
  SnapshotPresence,
} from "@/types/analysis-comparison";
import {
  formatEquipmentDefinition,
  formatProductionRate,
} from "@/lib/utils";
import { CountryDisplay } from "./CountryDisplay";

const formatNumber = (value: number | null) =>
  value === null
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: 15 });

function Delta({
  value,
  formatter = formatNumber,
}: {
  value: NumericDiff;
  formatter?: (value: number | null) => string;
}) {
  const { t } = useTranslation();
  if (value.delta === null)
    return <span className="comparison-delta-value unavailable">{t("compare.unavailableValue")}</span>;
  if (value.delta === 0)
    return <span className="comparison-delta-value no-change">—</span>;
  return (
    <span
      className={`comparison-delta-value ${
        value.delta > 0 ? "increase" : "decrease"
      }`}
    >
      {value.delta > 0 ? "+" : ""}
      {formatter(value.delta)}
    </span>
  );
}

function PresenceBadge({
  label,
  presence,
}: {
  label: string;
  presence: SnapshotPresence;
}) {
  const { t } = useTranslation();
  const state = presence === "base_only"
    ? t("compare.baseOnly")
    : presence === "target_only"
      ? t("compare.targetOnly")
      : null;
  return state ? (
    <span className={`comparison-equipment-presence ${presence}`}>
      {label}: {state}
    </span>
  ) : null;
}

function RateValue({
  rate,
  side,
}: {
  rate: ProductionRateComparison;
  side: "base" | "target";
}) {
  const { t } = useTranslation();
  const complete = side === "base" ? rate.baseComplete : rate.targetComplete;
  const value = side === "base" ? rate.before : rate.after;
  const known = side === "base" ? rate.baseKnown : rate.targetKnown;
  if (complete === null) return <span className="muted">—</span>;
  if (complete) return <>{formatProductionRate(value)}</>;
  return (
    <span className="comparison-equipment-incomplete">
      {known === null ? t("compare.valueUnavailable") : t("compare.equipment.known", { value: formatProductionRate(known) })}
      <small>{t("compare.equipment.incomplete")}</small>
    </span>
  );
}

function presentationOrder(
  left: EquipmentDefinitionComparison,
  right: EquipmentDefinitionComparison,
) {
  const stockpileMagnitude = (item: EquipmentDefinitionComparison) => {
    const delta = item.stockpile?.balance.delta;
    return delta === null || delta === undefined || delta === 0
      ? -1
      : Math.abs(delta);
  };
  const productionMagnitude = (item: EquipmentDefinitionComparison) =>
    Math.max(
      item.production?.activeFactories.delta
        ? Math.abs(item.production.activeFactories.delta)
        : -1,
      item.production?.currentItemsPerDay.delta
        ? Math.abs(item.production.currentItemsPerDay.delta)
        : -1,
    );
  return (
    stockpileMagnitude(right) - stockpileMagnitude(left) ||
    Number(
      right.stockpile !== null && right.stockpile.presence !== "both",
    ) -
      Number(
        left.stockpile !== null && left.stockpile.presence !== "both",
      ) ||
    productionMagnitude(right) - productionMagnitude(left) ||
    Number(
      right.production !== null && right.production.presence !== "both",
    ) -
      Number(
        left.production !== null && left.production.presence !== "both",
      ) ||
    left.equipmentDefinition.localeCompare(right.equipmentDefinition)
  );
}

export const EquipmentProductionComparisonPanel = memo(
  function EquipmentProductionComparisonPanel({
    countryTag,
    comparison,
  }: {
    countryTag: string | null;
    comparison: CountryEquipmentProductionComparison | null;
  }) {
    const { t } = useTranslation();
    const definitions = useMemo(
      () => [...(comparison?.definitions ?? [])].sort(presentationOrder),
      [comparison],
    );

    return (
      <section
        className="comparison-equipment-panel"
        aria-label={t("compare.equipment.aria")}
      >
        <div className="comparison-equipment-heading">
          <div>
            <span className="eyebrow">{t("compare.equipment.title")}</span>
            <h3>
              {countryTag ? (
                <CountryDisplay tag={countryTag} />
              ) : (
                t("common.selectCountry")
              )}
            </h3>
          </div>
          <p>
            {t("compare.equipment.semantics")}
          </p>
        </div>

        {!countryTag ? (
          <p className="comparison-equipment-empty micro-copy">
            {t("compare.equipment.select")}
          </p>
        ) : definitions.length === 0 ? (
          <p className="comparison-equipment-empty micro-copy">
            {t("compare.equipment.empty")}
          </p>
        ) : (
          <div
            className="table-wrap comparison-equipment-scroll"
            role="region"
            aria-label={t("compare.equipment.changesFor", { country: countryTag })}
            tabIndex={0}
          >
            <table className="recent-table comparison-equipment-table">
              <thead>
                <tr>
                  <th rowSpan={2}>{t("compare.equipment.definition")}</th>
                  <th colSpan={3}>{t("compare.equipment.stockpileBalance")}</th>
                  <th colSpan={3}>{t("compare.equipment.factorySlots")}</th>
                  <th colSpan={3}>{t("compare.equipment.rate")}</th>
                </tr>
                <tr>
                  {Array.from({ length: 3 }, (_, group) => (
                    <FragmentHeaders key={group} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {definitions.map((definition) => (
                  <tr key={definition.equipmentDefinition}>
                    <th scope="row" className="equipment-cell">
                      <strong>
                        {formatEquipmentDefinition(
                          definition.equipmentDefinition,
                        ) || t("compare.equipment.unknownDefinition")}
                      </strong>
                      <span className="production-code">
                        {definition.equipmentDefinition || t("compare.equipment.unknownRawDefinition")}
                      </span>
                      <span className="comparison-equipment-presences">
                        {definition.stockpile && (
                          <PresenceBadge
                            label={t("compare.equipment.stockpile")}
                            presence={definition.stockpile.presence}
                          />
                        )}
                        {definition.production && (
                          <PresenceBadge
                            label={t("compare.equipment.production")}
                            presence={definition.production.presence}
                          />
                        )}
                      </span>
                    </th>
                    <td className="numeric-cell comparison-equipment-group-start">
                      {formatNumber(definition.stockpile?.balance.before ?? null)}
                    </td>
                    <td className="numeric-cell">
                      {formatNumber(definition.stockpile?.balance.after ?? null)}
                    </td>
                    <td className="numeric-cell">
                      {definition.stockpile ? (
                        <Delta value={definition.stockpile.balance} />
                      ) : (
                        <span className="muted">{t("compare.unavailableValue")}</span>
                      )}
                    </td>
                    <td className="numeric-cell comparison-equipment-group-start">
                      {formatNumber(
                        definition.production?.activeFactories.before ?? null,
                      )}
                    </td>
                    <td className="numeric-cell">
                      {formatNumber(
                        definition.production?.activeFactories.after ?? null,
                      )}
                    </td>
                    <td className="numeric-cell">
                      {definition.production ? (
                        <Delta value={definition.production.activeFactories} />
                      ) : (
                        <span className="muted">{t("compare.unavailableValue")}</span>
                      )}
                    </td>
                    <td className="numeric-cell comparison-equipment-group-start">
                      {definition.production ? (
                        <RateValue
                          rate={definition.production.currentItemsPerDay}
                          side="base"
                        />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="numeric-cell">
                      {definition.production ? (
                        <RateValue
                          rate={definition.production.currentItemsPerDay}
                          side="target"
                        />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="numeric-cell">
                      {definition.production ? (
                        <Delta
                          value={definition.production.currentItemsPerDay}
                          formatter={formatProductionRate}
                        />
                      ) : (
                        <span className="muted">{t("compare.unavailableValue")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="comparison-equipment-note">
          {t("compare.equipment.note")}
        </p>
      </section>
    );
  },
);

function FragmentHeaders() {
  const { t } = useTranslation();
  return (
    <>
      <th className="numeric-cell comparison-equipment-group-start">{t("compare.base")}</th>
      <th className="numeric-cell">{t("compare.target")}</th>
      <th className="numeric-cell">{t("compare.change")}</th>
    </>
  );
}
