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

export const DivisionEquipmentTable = memo(
  function DivisionEquipmentTable({
    equipment,
    equipmentByRef,
  }: {
    equipment: DivisionEquipmentOccurrence[];
    equipmentByRef: ReadonlyMap<string, DivisionEquipmentCatalogEntry>;
  }) {
    return (
      <section className="land-forces-equipment-section">
        <div className="panel-head land-forces-section-head">
          <div>
            <h3>Current equipment</h3>
            <div className="micro-copy">
              {equipment.length.toLocaleString()} exact occurrences
            </div>
          </div>
        </div>
        {equipment.length === 0 ? (
          <div className="land-forces-inner-empty">
            No equipment occurrences were recorded for this division.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="recent-table land-forces-equipment-table">
              <thead>
                <tr>
                  <th>Design</th>
                  <th>Definition</th>
                  <th className="numeric-cell">Amount</th>
                  <th>Version</th>
                  <th>Creator / origin</th>
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
                            ? (definition.name ?? "Unnamed design")
                            : "Unknown equipment"}
                        </strong>
                        {definition?.obsolete && (
                          <span className="land-forces-muted-badge">
                            Obsolete
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
