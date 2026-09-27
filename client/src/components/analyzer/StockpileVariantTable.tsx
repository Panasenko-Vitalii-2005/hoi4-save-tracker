import { memo } from "react";
import type {
  StockpileDefinitionSummary,
  UnresolvedStockpileVariantSummary,
} from "@/types";
import { useAppTranslation } from "@/i18n";
import { resolveEquipmentVariantDisplayName } from "@/lib/utils";
import { StockpileBalance } from "./StockpileBalance";

function displayTag(tag: string | null): string {
  return tag || "—";
}

export const StockpileVariantTable = memo(function StockpileVariantTable({
  definition,
}: {
  definition: StockpileDefinitionSummary;
}) {
  const { t } = useAppTranslation();
  return (
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
          <tr key={`${variant.equipmentRef.type}:${variant.equipmentRef.id}`}>
            <td className="design-cell">
              <strong>
                {resolveEquipmentVariantDisplayName(
                  variant.definition,
                  variant.creatorTag,
                  variant.variantName,
                )}
              </strong>
              {variant.obsolete && (
                <span className="stockpile-obsolete">{t("common.obsolete")}</span>
              )}
            </td>
            <td className="numeric-cell">
              <StockpileBalance amount={variant.amount} />
            </td>
            <td className="stockpile-meta-cell">{variant.version ?? "—"}</td>
            <td className="stockpile-meta-cell">{displayTag(variant.creatorTag)}</td>
            <td className="stockpile-meta-cell">{displayTag(variant.originTag)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});

export const UnresolvedStockpileTable = memo(function UnresolvedStockpileTable({
  variants,
}: {
  variants: UnresolvedStockpileVariantSummary[];
}) {
  const { t } = useAppTranslation();
  if (variants.length === 0) return null;

  return (
    <section className="panel stockpile-unresolved-panel">
      <div className="panel-head">
        <div>
          <h2>{t("stockpile.unresolved")}</h2>
          <div className="micro-copy">{t("stockpile.unresolvedDescription")}</div>
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
            {variants.map((variant, index) => (
              <tr
                key={variant.equipmentRef
                  ? `${variant.equipmentRef.type}:${variant.equipmentRef.id}`
                  : `unknown-${index}`}
              >
                <td>{t("stockpile.unresolvedEquipment")}</td>
                <td className="numeric-cell">
                  <StockpileBalance amount={variant.amount} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
});
