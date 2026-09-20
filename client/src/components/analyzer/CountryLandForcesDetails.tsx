import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  CountryArmyHierarchySummary,
  CountryDivisionSummary,
  DivisionEquipmentCatalogEntry,
  DivisionSummary,
  DivisionTemplateCatalogEntry,
} from "@/types";
import { CountryDisplay } from "./CountryDisplay";
import { ArmyHierarchyView } from "./ArmyHierarchyView";
import { DivisionDetails } from "./DivisionDetails";
import { DivisionTable } from "./DivisionTable";

interface Props {
  country: CountryDivisionSummary;
  hierarchy: CountryArmyHierarchySummary | null;
  divisionByRef: ReadonlyMap<string, DivisionSummary>;
  templateByRef: ReadonlyMap<string, DivisionTemplateCatalogEntry>;
  equipmentByRef: ReadonlyMap<string, DivisionEquipmentCatalogEntry>;
  assignedRefs: ReadonlySet<string>;
  selectedDivisionKey: string | null;
  selectedDivision: DivisionSummary | null;
  selectedTemplate: DivisionTemplateCatalogEntry | null;
  onSelectDivision: (divisionKey: string) => void;
}

export const CountryLandForcesDetails = memo(
  function CountryLandForcesDetails({
    country,
    hierarchy,
    divisionByRef,
    templateByRef,
    equipmentByRef,
    assignedRefs,
    selectedDivisionKey,
    selectedDivision,
    selectedTemplate,
    onSelectDivision,
  }: Props) {
    const { t } = useTranslation();
    const hasHierarchy = Boolean(
      hierarchy &&
        (hierarchy.armyGroups.length > 0 ||
          hierarchy.grouplessArmies.length > 0 ||
          hierarchy.unassignedDivisions.length > 0),
    );
    const [view, setView] = useState<"hierarchy" | "divisions">(
      hasHierarchy ? "hierarchy" : "divisions",
    );
    const effectiveView = hasHierarchy ? view : "divisions";
    const armyCount = useMemo(
      () =>
        (hierarchy?.grouplessArmies.length ?? 0) +
        (hierarchy?.armyGroups.reduce(
          (total, group) => total + group.armies.length,
          0,
        ) ?? 0),
      [hierarchy],
    );
    const expeditionaryCount = useMemo(
      () =>
        country.divisions.filter(
          ({ expeditionaryOwnerTag }) => expeditionaryOwnerTag !== null,
        ).length,
      [country.divisions],
    );

    const summary = [
      [t("land.divisions"), country.divisionCount],
      [t("land.fullManpower"), country.fullManpowerDivisionCount],
      [t("land.under"), country.underManpowerDivisionCount],
      [t("land.armies"), armyCount],
      [t("land.armyGroups"), hierarchy?.armyGroups.length ?? 0],
      [t("land.unassigned"), hierarchy?.unassignedDivisionCount ?? 0],
      [t("land.expeditionary"), expeditionaryCount],
    ] as const;
    const manpowerProgress =
      country.requiredManpowerTotal > 0 &&
      country.currentManpowerTotal >= 0 &&
      country.currentManpowerTotal <= country.requiredManpowerTotal
        ? country.currentManpowerTotal / country.requiredManpowerTotal
        : null;

    return (
      <div className="land-forces-details-column">
        <section className="panel land-forces-country-details">
          <div className="land-forces-detail-head">
            <div>
              <h2>
                <CountryDisplay tag={country.countryTag} />
              </h2>
              <div className="micro-copy">
                {t("land.currentSnapshot")}
              </div>
            </div>
          </div>

          <div className="land-forces-manpower-overview">
            <div className="land-forces-manpower-copy">
              <span>{t("land.currentManpower")}</span>
              <strong>
                {country.currentManpowerTotal.toLocaleString()}
                <small>
                  / {country.requiredManpowerTotal.toLocaleString()} {t("land.required")}
                </small>
              </strong>
            </div>
            <div className="land-forces-manpower-missing">
              <span>{t("land.missing")}</span>
              <strong>{country.missingManpowerTotal.toLocaleString()}</strong>
            </div>
            {manpowerProgress !== null && (
              <div
                className="land-forces-manpower-track"
                role="progressbar"
                aria-label={t("land.manpowerProgress")}
                aria-valuemin={0}
                aria-valuemax={country.requiredManpowerTotal}
                aria-valuenow={country.currentManpowerTotal}
              >
                <span style={{ width: `${manpowerProgress * 100}%` }} />
              </div>
            )}
          </div>

          <dl className="land-forces-summary-grid">
            {summary.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value.toLocaleString()}</dd>
              </div>
            ))}
          </dl>

          <div
            className="land-forces-view-tabs"
            role="tablist"
            aria-label={t("land.views", { country: country.countryTag })}
          >
            <button
              type="button"
              role="tab"
              aria-selected={effectiveView === "hierarchy"}
              className={effectiveView === "hierarchy" ? "active" : ""}
              disabled={!hasHierarchy}
              onClick={() => setView("hierarchy")}
            >
              {t("land.hierarchy")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={effectiveView === "divisions"}
              className={effectiveView === "divisions" ? "active" : ""}
              onClick={() => setView("divisions")}
            >
              {t("land.divisions")}
            </button>
          </div>

          {effectiveView === "hierarchy" ? (
            <ArmyHierarchyView
              hierarchy={hierarchy}
              divisionByRef={divisionByRef}
              templateByRef={templateByRef}
              selectedDivisionKey={selectedDivisionKey}
              onSelectDivision={onSelectDivision}
            />
          ) : (
            <DivisionTable
              divisions={country.divisions}
              templateByRef={templateByRef}
              assignedRefs={assignedRefs}
              selectedDivisionKey={selectedDivisionKey}
              onSelectDivision={onSelectDivision}
            />
          )}
        </section>

        <DivisionDetails
          division={selectedDivision}
          template={selectedTemplate}
          equipmentByRef={equipmentByRef}
        />
      </div>
    );
  },
);
