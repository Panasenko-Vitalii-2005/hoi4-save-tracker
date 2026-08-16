import { memo, useMemo, useState } from "react";
import type {
  CountryArmyHierarchySummary,
  CountryDivisionSummary,
  DivisionEquipmentCatalogEntry,
  DivisionSummary,
  DivisionTemplateCatalogEntry,
} from "@/types";
import { countryFullName } from "@/lib/utils";
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
      ["Divisions", country.divisionCount],
      ["Current manpower", country.currentManpowerTotal],
      ["Required manpower", country.requiredManpowerTotal],
      ["Missing manpower", country.missingManpowerTotal],
      ["Full manpower", country.fullManpowerDivisionCount],
      ["Under manpower", country.underManpowerDivisionCount],
      ["Armies", armyCount],
      ["Army groups", hierarchy?.armyGroups.length ?? 0],
      ["Unassigned", hierarchy?.unassignedDivisionCount ?? 0],
      ["Expeditionary", expeditionaryCount],
    ] as const;

    return (
      <div className="land-forces-details-column">
        <section className="panel land-forces-country-details">
          <div className="land-forces-detail-head">
            <div>
              <h2>{countryFullName(country.countryTag)}</h2>
              <div className="micro-copy">
                Current land-force snapshot · {country.countryTag}
              </div>
            </div>
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
            aria-label={`${country.countryTag} land-force views`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={effectiveView === "hierarchy"}
              className={effectiveView === "hierarchy" ? "active" : ""}
              disabled={!hasHierarchy}
              onClick={() => setView("hierarchy")}
            >
              Army hierarchy
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={effectiveView === "divisions"}
              className={effectiveView === "divisions" ? "active" : ""}
              onClick={() => setView("divisions")}
            >
              Divisions
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
