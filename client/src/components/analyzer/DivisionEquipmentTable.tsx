import { memo } from "react";
import type {
  DivisionEquipmentCatalogEntry,
  DivisionEquipmentOccurrence,
} from "@/types";
import {
  equipmentReferenceKey,
  formatCountryDisplayName,
  formatEquipmentDefinition,
  formatStockpileAmount,
} from "@/lib/utils";
import { useAppTranslation } from "@/i18n";

export const DivisionEquipmentTable = memo(
  function DivisionEquipmentTable({
    equipment,
    equipmentByRef,
  }: {
    equipment: DivisionEquipmentOccurrence[];
    equipmentByRef: ReadonlyMap<string, DivisionEquipmentCatalogEntry>;
  }) {
    const { t } = useAppTranslation();
    return (
      <section className="land-forces-equipment-section">
        <div className="panel-head land-forces-section-head">
          <div>
            <h3>{t("land.currentEquipment")}</h3>
            <div className="micro-copy">
              {t("land.exactOccurrences", { count: equipment.length.toLocaleString() })}
            </div>
          </div>
        </div>
        {equipment.length === 0 ? (
          <div className="land-forces-inner-empty">
            {t("land.noEquipment")}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="recent-table land-forces-equipment-table">
              <thead>
                <tr>
                  <th>{t("production.design")}</th>
                  <th>{t("land.definition")}</th>
                  <th className="numeric-cell">{t("stockpile.amount")}</th>
                  <th>{t("stockpile.version")}</th>
                  <th>{t("land.creatorOrigin")}</th>
                </tr>
              </thead>
              <tbody>
                {equipment.map((occurrence, index) => {
                  const key = equipmentReferenceKey(occurrence.equipmentRef);
                  const definition = key ? equipmentByRef.get(key) : undefined;
                  return (
                    <tr key={`${key ?? "missing"}-${index}`}>
                      <td className="equipment-cell">
                        <strong>
                          {definition
                            ? (definition.name ?? t("production.unnamedDesign"))
                            : t("land.unknownEquipment")}
                        </strong>
                        {definition?.obsolete && (
                          <span className="land-forces-muted-badge">
                            {t("common.obsolete")}
                          </span>
                        )}
                        {!definition && key && (
                          <span className="land-forces-code">Ref {key}</span>
                        )}
                      </td>
                      <td className="definition-cell">
                        {definition
                          ? formatEquipmentDefinition(definition.definition)
                          : "—"}
                        {definition && (
                          <span className="land-forces-code">
                            {definition.definition}
                          </span>
                        )}
                      </td>
                      <td className="numeric-cell">
                        {occurrence.amount === null
                          ? "—"
                          : formatStockpileAmount(occurrence.amount)}
                      </td>
                      <td>{definition?.version ?? "—"}</td>
                      <td>
                        {definition
                          ? `${formatCountryDisplayName(
                              definition.creatorTag,
                            )} / ${formatCountryDisplayName(
                              definition.originTag,
                            )}`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  },
);
