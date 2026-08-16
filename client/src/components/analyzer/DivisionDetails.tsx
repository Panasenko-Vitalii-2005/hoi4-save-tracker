import { memo } from "react";
import type {
  DivisionEquipmentCatalogEntry,
  DivisionSummary,
  DivisionTemplateCatalogEntry,
} from "@/types";
import {
  countryFullName,
  equipmentReferenceKey,
  formatDivisionRatio,
  formatStockpileAmount,
} from "@/lib/utils";
import { DivisionEquipmentTable } from "./DivisionEquipmentTable";
import { DivisionTemplateDetails } from "./DivisionTemplateDetails";

function valueText(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? "—"
    : formatStockpileAmount(value);
}

function booleanText(value: boolean | null): string {
  if (value === null) return "—";
  return value ? "Yes" : "No";
}

export const DivisionDetails = memo(function DivisionDetails({
  division,
  template,
  equipmentByRef,
}: {
  division: DivisionSummary | null;
  template: DivisionTemplateCatalogEntry | null;
  equipmentByRef: ReadonlyMap<string, DivisionEquipmentCatalogEntry>;
}) {
  if (!division) {
    return (
      <section className="panel land-forces-division-details land-forces-empty">
        Select a division to inspect its exact snapshot data.
      </section>
    );
  }

  const name = division.overrideName ?? template?.name ?? "Unnamed division";
  const controllerName = countryFullName(division.countryTag);
  const provenance = [
    [
      "Controller country",
      controllerName === division.countryTag
        ? division.countryTag
        : `${controllerName} (${division.countryTag})`,
    ],
    [
      "Logical country",
      division.logicalCountryTag &&
      division.logicalCountryTag !== division.countryTag
        ? division.logicalCountryTag
        : "Same as controller",
    ],
    ["Expeditionary owner", division.expeditionaryOwnerTag],
    ["Template", template?.name],
    ["Template role", template?.role],
    ["Current manpower source", division.currentManpowerTag],
    ["Required manpower source", division.requiredManpowerTag],
  ] as const;
  const manpower = [
    ["Current manpower", valueText(division.currentManpower)],
    ["Required manpower", valueText(division.requiredManpower)],
    ["Missing manpower", valueText(division.missingManpower)],
    ["Manpower completeness", formatDivisionRatio(division.manpowerCompleteness)],
  ] as const;
  const rawState = [
    ["Strength (raw)", valueText(division.strength)],
    ["Organization (raw)", valueText(division.organization)],
    ["Experience (raw)", valueText(division.experience)],
    ["Province ID", valueText(division.provinceId)],
    ["Record status", division.complete ? "Complete" : "Partial"],
  ] as const;
  const supply = [
    ["Current supply", valueText(division.supply.current)],
    ["Maximum supply", valueText(division.supply.max)],
    ["Supply ratio", formatDivisionRatio(division.supplyRatio)],
    ["Supply gain", valueText(division.supply.gain)],
    ["Out-of-supply days", valueText(division.supply.outOfSupplyDays)],
    ["Disrupted supply", valueText(division.supply.disrupted)],
    ["Fuel", valueText(division.fuel)],
    ["Fuel requested", valueText(division.fuelRequested)],
  ] as const;
  const status = [
    [
      "Strategic redeployment",
      booleanText(division.status.strategicRedeployment),
    ],
    ["Retreat", booleanText(division.status.retreat)],
    ["Support attack", valueText(division.status.supportAttack)],
  ] as const;

  return (
    <section className="panel land-forces-division-details">
      <div className="land-forces-detail-head">
        <div>
          <h2>{name}</h2>
          <div className="micro-copy">
            Division reference {equipmentReferenceKey(division.divisionRef) ?? "unavailable"}
            {(division.nameType !== null || division.nameOrder !== null) && (
              <>
                {" "}
                · Name descriptor {division.nameType ?? "—"} /{" "}
                {division.nameOrder ?? "—"}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="land-forces-details-sections">
        <section>
          <h3>Identity and provenance</h3>
          <dl className="land-forces-detail-grid">
            {provenance.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h3>Manpower</h3>
          <dl className="land-forces-detail-grid">
            {manpower.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h3>Raw state</h3>
          <dl className="land-forces-detail-grid">
            {rawState.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h3>Supply and fuel</h3>
          <dl className="land-forces-detail-grid">
            {supply.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h3>Status</h3>
          <dl className="land-forces-detail-grid">
            {status.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <DivisionTemplateDetails
        template={template}
        templateRef={division.divisionTemplateRef}
      />
      <DivisionEquipmentTable
        equipment={division.equipment}
        equipmentByRef={equipmentByRef}
      />
    </section>
  );
});
