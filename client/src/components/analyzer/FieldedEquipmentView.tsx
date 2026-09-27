import { Fragment, memo, useState } from "react";
import type { CountryFieldedEquipmentSummary } from "@/types";
import {
  formatEquipmentDefinition,
  formatStockpileAmount,
  resolveEquipmentVariantDisplayName,
} from "@/lib/utils";
import { useAppTranslation } from "@/i18n";

function displayAmount(amount: number): string {
  // Grouped IEEE-754 sums can contain an insignificant binary tail. This is
  // presentation-only; the API retains the unrounded numeric amount.
  return formatStockpileAmount(Number(amount.toPrecision(15)));
}

export const FieldedEquipmentView = memo(function FieldedEquipmentView({
  summary,
}: {
  summary: CountryFieldedEquipmentSummary | null;
}) {
  const { t } = useAppTranslation();
  const [expandedDefinition, setExpandedDefinition] = useState<string | null>(null);

  if (summary === null) {
    return <div className="land-forces-inner-empty">{t("fielded.unavailable")}</div>;
  }

  return (
    <section className="fielded-equipment-view">
      <p className="micro-copy">{t("fielded.description")}</p>
      {summary.definitions.length === 0 ? (
        <div className="land-forces-inner-empty">{t("fielded.empty")}</div>
      ) : (
        <div className="table-wrap stockpile-definition-wrap">
          <table className="recent-table stockpile-definition-table fielded-equipment-table">
            <thead>
              <tr>
                <th>{t("stockpile.equipment")}</th>
                <th className="numeric-cell">{t("fielded.amount")}</th>
                <th className="numeric-cell">{t("fielded.variants")}</th>
              </tr>
            </thead>
            <tbody>
              {summary.definitions.map((definition) => {
                const name = formatEquipmentDefinition(definition.definition);
                const expanded = expandedDefinition === definition.definition;
                return (
                  <Fragment key={definition.definition}>
                    <tr className={expanded ? "selected" : ""}>
                      <td className="equipment-cell">
                        <button
                          type="button"
                          className="stockpile-expand-button"
                          aria-expanded={expanded}
                          aria-label={t(expanded ? "stockpile.hideVariants" : "stockpile.inspectVariants", { name })}
                          onClick={() => setExpandedDefinition(expanded ? null : definition.definition)}
                        >
                          <span className="stockpile-chevron" aria-hidden="true">▸</span>
                          <span>
                            <strong>{name}</strong>
                            <span className="stockpile-definition-code">{definition.definition}</span>
                          </span>
                        </button>
                      </td>
                      <td className="numeric-cell">{displayAmount(definition.amount)}</td>
                      <td className="numeric-cell">{definition.variants.length.toLocaleString()}</td>
                    </tr>
                    {expanded && (
                      <tr className="stockpile-variant-expansion">
                        <td colSpan={3}>
                          <div className="stockpile-variant-scroll">
                            <table className="recent-table stockpile-variant-table">
                              <thead>
                                <tr>
                                  <th>{t("production.design")}</th>
                                  <th className="numeric-cell">{t("fielded.amount")}</th>
                                  <th>{t("stockpile.version")}</th>
                                  <th>{t("stockpile.creator")}</th>
                                  <th>{t("stockpile.origin")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {definition.variants.map((variant) => (
                                  <tr key={`${variant.equipmentRef.type}:${variant.equipmentRef.id}`}>
                                    <td className="design-cell">
                                      <strong>{resolveEquipmentVariantDisplayName(
                                        variant.definition,
                                        variant.creatorTag,
                                        variant.variantName,
                                      )}</strong>
                                      {variant.obsolete && <span className="stockpile-obsolete">{t("common.obsolete")}</span>}
                                    </td>
                                    <td className="numeric-cell">{displayAmount(variant.amount)}</td>
                                    <td className="stockpile-meta-cell">{variant.version ?? "—"}</td>
                                    <td className="stockpile-meta-cell">{variant.creatorTag ?? "—"}</td>
                                    <td className="stockpile-meta-cell">{variant.originTag ?? "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {summary.unresolvedOccurrences.length > 0 && (
        <div className="fielded-unresolved">
          <h3>{t("fielded.unresolved")}</h3>
          <p className="micro-copy">{t("fielded.unresolvedDescription")}</p>
          <div className="table-wrap">
            <table className="recent-table">
              <thead><tr><th>{t("land.definition")}</th><th className="numeric-cell">{t("fielded.amount")}</th></tr></thead>
              <tbody>
                {summary.unresolvedOccurrences.map((entry, index) => (
                  <tr key={`${entry.equipmentRef?.type ?? "unknown"}:${entry.equipmentRef?.id ?? index}:${index}`}>
                    <td>{entry.equipmentRef ? `${entry.equipmentRef.type}:${entry.equipmentRef.id}` : t("land.unknownEquipment")}</td>
                    <td className="numeric-cell">{entry.amount === null ? "—" : displayAmount(entry.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
});
