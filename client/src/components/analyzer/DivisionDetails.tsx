import { memo } from "react";
import { useTranslation } from "react-i18next";
import type {
  DivisionEquipmentCatalogEntry,
  DivisionSummary,
  DivisionTemplateCatalogEntry,
} from "@/types";
import {
  equipmentReferenceKey,
  formatCountryDisplayName,
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

function booleanText(value: boolean | null, yes: string, no: string): string {
  if (value === null) return "—";
  return value ? yes : no;
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
  const { t } = useTranslation();
  if (!division) {
    return (
      <section className="panel land-forces-division-details land-forces-empty">
        {t("land.selectDivision")}
      </section>
    );
  }

  const name = division.overrideName ?? template?.name ?? t("land.unnamedDivision");
  const provenance = [
    [t("land.controllerCountry"), formatCountryDisplayName(division.countryTag)],
    [
      t("land.logicalCountry"),
      division.logicalCountryTag &&
      division.logicalCountryTag !== division.countryTag
        ? formatCountryDisplayName(division.logicalCountryTag)
        : t("land.sameAsController"),
    ],
    [
      t("land.expeditionaryOwner"),
      formatCountryDisplayName(division.expeditionaryOwnerTag),
    ],
    [t("land.template"), template?.name],
    [t("land.templateRole"), template?.role],
    [
      t("land.currentManpowerSource"),
      formatCountryDisplayName(division.currentManpowerTag),
    ],
    [
      t("land.requiredManpowerSource"),
      formatCountryDisplayName(division.requiredManpowerTag),
    ],
  ] as const;
  const manpower = [
    [t("land.currentManpower"), valueText(division.currentManpower)],
    [t("land.requiredManpower"), valueText(division.requiredManpower)],
    [t("land.missingManpower"), valueText(division.missingManpower)],
    [t("land.manpowerCompleteness"), formatDivisionRatio(division.manpowerCompleteness)],
  ] as const;
  const rawState = [
    [t("land.strengthRaw"), valueText(division.strength)],
    [t("land.organizationRaw"), valueText(division.organization)],
    [t("land.experienceRaw"), valueText(division.experience)],
    [t("land.provinceId"), valueText(division.provinceId)],
    [t("land.recordStatus"), division.complete ? t("land.complete") : t("common.partial")],
  ] as const;
  const supply = [
    [t("land.currentSupply"), valueText(division.supply.current)],
    [t("land.maximumSupply"), valueText(division.supply.max)],
    [t("land.supplyRatio"), formatDivisionRatio(division.supplyRatio)],
    [t("land.supplyGain"), valueText(division.supply.gain)],
    [t("land.outOfSupplyDays"), valueText(division.supply.outOfSupplyDays)],
    [t("land.disruptedSupply"), valueText(division.supply.disrupted)],
    [t("land.fuel"), valueText(division.fuel)],
    [t("land.fuelRequested"), valueText(division.fuelRequested)],
  ] as const;
  const status = [
    [
      t("land.strategicRedeployment"),
      booleanText(division.status.strategicRedeployment, t("common.yes"), t("common.no")),
    ],
    [t("land.retreat"), booleanText(division.status.retreat, t("common.yes"), t("common.no"))],
    [t("land.supportAttack"), valueText(division.status.supportAttack)],
  ] as const;

  return (
    <section className="panel land-forces-division-details">
      <div className="land-forces-detail-head">
        <div>
          <h2>{name}</h2>
          <div className="micro-copy">
            {t("land.divisionReference", { reference: equipmentReferenceKey(division.divisionRef) ?? t("land.referenceUnavailable") })}
            {(division.nameType !== null || division.nameOrder !== null) && (
              <>
                {" "}
                · {t("land.nameDescriptor", { type: division.nameType ?? "—", order: division.nameOrder ?? "—" })}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="land-forces-details-sections">
        <section>
          <h3>{t("land.identity")}</h3>
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
          <h3>{t("land.manpower")}</h3>
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
          <h3>{t("land.rawState")}</h3>
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
          <h3>{t("land.supplyFuel")}</h3>
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
          <h3>{t("land.status")}</h3>
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
