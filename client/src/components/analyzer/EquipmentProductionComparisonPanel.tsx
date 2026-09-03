import { memo, useMemo } from "react";
import type {
  CountryEquipmentProductionComparison,
  EquipmentDefinitionComparison,
  NumericDiff,
  ProductionRateComparison,
  SnapshotPresence,
} from "@/types/analysis-comparison";
import { formatEquipmentDefinition } from "@/lib/utils";
import { CountryDisplay } from "./CountryDisplay";

const formatNumber = (value: number | null) =>
  value === null
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: 15 });

function Delta({ value }: { value: NumericDiff }) {
  if (value.delta === null)
    return <span className="comparison-delta-value unavailable">N/A</span>;
  if (value.delta === 0)
    return <span className="comparison-delta-value no-change">—</span>;
  return (
    <span
      className={`comparison-delta-value ${
        value.delta > 0 ? "increase" : "decrease"
      }`}
    >
      {value.delta > 0 ? "+" : ""}
      {formatNumber(value.delta)}
    </span>
  );
}

const presenceLabel = (value: SnapshotPresence) =>
  value === "base_only"
    ? "Base only"
    : value === "target_only"
      ? "Target only"
      : null;

function PresenceBadge({
  label,
  presence,
}: {
  label: string;
  presence: SnapshotPresence;
}) {
  const state = presenceLabel(presence);
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
  const complete = side === "base" ? rate.baseComplete : rate.targetComplete;
  const value = side === "base" ? rate.before : rate.after;
  const known = side === "base" ? rate.baseKnown : rate.targetKnown;
  if (complete === null) return <span className="muted">—</span>;
  if (complete) return <>{formatNumber(value)}</>;
  return (
    <span className="comparison-equipment-incomplete">
      {known === null ? "Unavailable" : `Known ${formatNumber(known)}`}
      <small>Incomplete</small>
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
    const definitions = useMemo(
      () => [...(comparison?.definitions ?? [])].sort(presentationOrder),
      [comparison],
    );

    return (
      <section
        className="comparison-equipment-panel"
        aria-label="Equipment and production comparison"
      >
        <div className="comparison-equipment-heading">
          <div>
            <span className="eyebrow">Equipment &amp; production</span>
            <h3>
              {countryTag ? (
                <CountryDisplay tag={countryTag} />
              ) : (
                "Select a country"
              )}
            </h3>
          </div>
          <p>
            Exact equipment definitions · Target − Base snapshot comparison
          </p>
        </div>

        {!countryTag ? (
          <p className="comparison-equipment-empty micro-copy">
            Select a country to inspect equipment and production changes.
          </p>
        ) : definitions.length === 0 ? (
          <p className="comparison-equipment-empty micro-copy">
            No comparable stockpile or military production definitions were
            found for this country.
          </p>
        ) : (
          <div
            className="table-wrap comparison-equipment-scroll"
            role="region"
            aria-label={`Equipment and production changes for ${countryTag}`}
            tabIndex={0}
          >
            <table className="recent-table comparison-equipment-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Equipment definition</th>
                  <th colSpan={3}>National stockpile balance</th>
                  <th colSpan={3}>Active production factory slots</th>
                  <th colSpan={3}>Current production rate / day</th>
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
                        ) || "Unknown equipment definition"}
                      </strong>
                      <span className="production-code">
                        {definition.equipmentDefinition || "Unknown definition"}
                      </span>
                      <span className="comparison-equipment-presences">
                        {definition.stockpile && (
                          <PresenceBadge
                            label="Stockpile"
                            presence={definition.stockpile.presence}
                          />
                        )}
                        {definition.production && (
                          <PresenceBadge
                            label="Production"
                            presence={definition.production.presence}
                          />
                        )}
                      </span>
                    </th>
                    <td className="numeric-cell">
                      {formatNumber(definition.stockpile?.balance.before ?? null)}
                    </td>
                    <td className="numeric-cell">
                      {formatNumber(definition.stockpile?.balance.after ?? null)}
                    </td>
                    <td className="numeric-cell">
                      {definition.stockpile ? (
                        <Delta value={definition.stockpile.balance} />
                      ) : (
                        <span className="muted">N/A</span>
                      )}
                    </td>
                    <td className="numeric-cell">
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
                        <span className="muted">N/A</span>
                      )}
                    </td>
                    <td className="numeric-cell">
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
                        />
                      ) : (
                        <span className="muted">N/A</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="comparison-equipment-note">
          Stockpile values are signed national balances. Production values are
          current land/air snapshot metrics; incomplete rates have no calculated
          delta. Factory slots do not necessarily reconcile with effective MIL.
        </p>
      </section>
    );
  },
);

function FragmentHeaders() {
  return (
    <>
      <th className="numeric-cell">Base</th>
      <th className="numeric-cell">Target</th>
      <th className="numeric-cell">Change</th>
    </>
  );
}
