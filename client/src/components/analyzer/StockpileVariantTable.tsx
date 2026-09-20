import { memo } from "react";
import type {
  StockpileDefinitionSummary,
  UnresolvedStockpileVariantSummary,
} from "@/types";
import {
  formatCountryDisplayName,
  formatEquipmentDefinition,
  formatStockpileAmount,
} from "@/lib/utils";
import { useAppTranslation } from "@/i18n";

function displayTag(tag: string | null): string {
  if (!tag) return "—";
  return formatCountryDisplayName(tag);
}

function unresolvedKey(
  variant: UnresolvedStockpileVariantSummary,
  index: number,
): string {
  return variant.equipmentRef
    ? `${variant.equipmentRef.type}:${variant.equipmentRef.id}`
    : `unknown-${index}`;
}

export const StockpileVariantTable = memo(function StockpileVariantTable({
  definition,
  unresolvedVariants,
}: {
  definition: StockpileDefinitionSummary | null;
  unresolvedVariants: UnresolvedStockpileVariantSummary[];
}) {
  const { t } = useAppTranslation();
  return (
    <>
      <section className="panel stockpile-variant-panel">
        {!definition ? (
          <div className="stockpile-inner-empty">
            Select an equipment definition to inspect its designs.
          </div>
        ) : (
          <>
            <div className="panel-head stockpile-variant-head">
              <div>
                <h2>{t("stockpile.designs")}</h2>
                <div className="micro-copy">
                  {formatEquipmentDefinition(definition.definition)}
                </div>
              </div>
              <strong className="stockpile-definition-total">
                {formatStockpileAmount(definition.amount)}
              </strong>
            </div>
            <div className="table-wrap">
              <table className="recent-table stockpile-variant-table">
                <thead>
                  <tr>
                    <th>{t("production.design")}</th>
                    <th className="numeric-cell">{t("stockpile.amount")}</th>
                    <th>{t("stockpile.version")}</th>
                    <th>{t("stockpile.creator")}</th>
                    <th>{t("stockpile.origin")}</th>
                  </tr>
                </thead>
                <tbody>
                  {definition.variants.map((variant) => (
                    <tr
                      key={`${variant.equipmentRef.type}:${variant.equipmentRef.id}`}
                    >
                      <td className="design-cell">
                        <strong>
                          {variant.variantName?.trim() || t("production.unnamedDesign")}
                        </strong>
                        {variant.obsolete && (
                          <span className="stockpile-obsolete">{t("common.obsolete")}</span>
                        )}
                      </td>
                      <td className="numeric-cell">
                        {formatStockpileAmount(variant.amount)}
                      </td>
                      <td className="stockpile-meta-cell">
                        {variant.version ?? "—"}
                      </td>
                      <td className="stockpile-meta-cell">
                        {displayTag(variant.creatorTag)}
                      </td>
                      <td className="stockpile-meta-cell">
                        {displayTag(variant.originTag)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {unresolvedVariants.length > 0 && (
        <section className="panel stockpile-unresolved-panel">
          <div className="panel-head">
            <div>
              <h2>{t("stockpile.unresolved")}</h2>
              <div className="micro-copy">
                Definition metadata is unavailable for these balances.
              </div>
            </div>
          </div>
          <div className="table-wrap">
            <table className="recent-table stockpile-unresolved-table">
              <thead>
                <tr>
                  <th>{t("stockpile.equipment")}</th>
                  <th className="numeric-cell">{t("stockpile.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {unresolvedVariants.map((variant, index) => (
                  <tr key={unresolvedKey(variant, index)}>
                    <td>{t("stockpile.unresolvedEquipment")}</td>
                    <td className="numeric-cell">
                      {formatStockpileAmount(variant.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
});
