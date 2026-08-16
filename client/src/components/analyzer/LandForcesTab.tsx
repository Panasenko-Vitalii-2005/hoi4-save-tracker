import { useCallback, useEffect, useMemo } from "react";
import type {
  CountryArmyHierarchySummary,
  CountryDivisionSummary,
  DivisionEquipmentCatalogEntry,
  DivisionSummary,
  DivisionTemplateCatalogEntry,
} from "@/types";
import { equipmentReferenceKey } from "@/lib/utils";
import { CountryDivisionTable } from "./CountryDivisionTable";
import { CountryLandForcesDetails } from "./CountryLandForcesDetails";

interface Props {
  summaries: CountryDivisionSummary[];
  templates: DivisionTemplateCatalogEntry[];
  equipment: DivisionEquipmentCatalogEntry[];
  hierarchies: CountryArmyHierarchySummary[];
  selectedTag: string | null;
  selectedDivisionKey: string | null;
  onSelectedTagChange: (tag: string | null) => void;
  onSelectedDivisionKeyChange: (key: string | null) => void;
}

export function LandForcesTab({
  summaries,
  templates,
  equipment,
  hierarchies,
  selectedTag,
  selectedDivisionKey,
  onSelectedTagChange,
  onSelectedDivisionKeyChange,
}: Props) {
  const templateByRef = useMemo(
    () =>
      new Map(
        templates.map((template) => [
          equipmentReferenceKey(template.templateRef) as string,
          template,
        ]),
      ),
    [templates],
  );
  const equipmentByRef = useMemo(
    () =>
      new Map(
        equipment.map((definition) => [
          equipmentReferenceKey(definition.equipmentRef) as string,
          definition,
        ]),
      ),
    [equipment],
  );
  const divisionByRef = useMemo(() => {
    const lookup = new Map<string, DivisionSummary>();
    for (const country of summaries) {
      for (const division of country.divisions) {
        const key = equipmentReferenceKey(division.divisionRef);
        if (key) lookup.set(key, division);
      }
    }
    return lookup;
  }, [summaries]);
  const hierarchyByCountry = useMemo(
    () =>
      new Map(
        hierarchies.map((hierarchy) => [hierarchy.countryTag, hierarchy]),
      ),
    [hierarchies],
  );
  const selectedCountry = useMemo(
    () =>
      summaries.find((country) => country.countryTag === selectedTag) ?? null,
    [selectedTag, summaries],
  );
  const selectedHierarchy = selectedCountry
    ? (hierarchyByCountry.get(selectedCountry.countryTag) ?? null)
    : null;
  const selectedDivisionByKey = useMemo(() => {
    const lookup = new Map<string, DivisionSummary>();
    selectedCountry?.divisions.forEach((division, index) => {
      const key =
        equipmentReferenceKey(division.divisionRef) ??
        `${division.countryTag}:missing:${index}`;
      lookup.set(key, division);
    });
    return lookup;
  }, [selectedCountry]);
  const selectedDivision = selectedDivisionKey
    ? (selectedDivisionByKey.get(selectedDivisionKey) ?? null)
    : null;
  const selectedTemplate = useMemo(() => {
    const key = equipmentReferenceKey(selectedDivision?.divisionTemplateRef);
    return key ? (templateByRef.get(key) ?? null) : null;
  }, [selectedDivision, templateByRef]);
  const assignedRefs = useMemo(() => {
    const refs = new Set<string>();
    if (!selectedHierarchy) return refs;
    const armies = [
      ...selectedHierarchy.armyGroups.flatMap(({ armies }) => armies),
      ...selectedHierarchy.grouplessArmies,
    ];
    for (const army of armies) {
      for (const division of army.divisions) {
        const key = equipmentReferenceKey(division.divisionRef);
        if (key) refs.add(key);
      }
    }
    return refs;
  }, [selectedHierarchy]);

  useEffect(() => {
    if (
      selectedTag &&
      summaries.some((country) => country.countryTag === selectedTag)
    ) {
      return;
    }
    onSelectedTagChange(summaries[0]?.countryTag ?? null);
    onSelectedDivisionKeyChange(null);
  }, [
    onSelectedDivisionKeyChange,
    onSelectedTagChange,
    selectedTag,
    summaries,
  ]);

  useEffect(() => {
    if (
      selectedDivisionKey &&
      !selectedDivisionByKey.has(selectedDivisionKey)
    ) {
      onSelectedDivisionKeyChange(null);
    }
  }, [
    onSelectedDivisionKeyChange,
    selectedDivisionByKey,
    selectedDivisionKey,
  ]);

  const handleCountrySelect = useCallback(
    (tag: string) => {
      onSelectedTagChange(tag);
      onSelectedDivisionKeyChange(null);
    },
    [onSelectedDivisionKeyChange, onSelectedTagChange],
  );

  if (summaries.length === 0) {
    return (
      <section className="panel land-forces-empty land-forces-empty-save">
        No land-force divisions were found in this save.
      </section>
    );
  }

  return (
    <>
      <div className="land-forces-layout">
        <CountryDivisionTable
          countries={summaries}
          selectedTag={selectedTag}
          onSelect={handleCountrySelect}
        />
        {selectedCountry ? (
          <CountryLandForcesDetails
            key={selectedCountry.countryTag}
            country={selectedCountry}
            hierarchy={selectedHierarchy}
            divisionByRef={divisionByRef}
            templateByRef={templateByRef}
            equipmentByRef={equipmentByRef}
            assignedRefs={assignedRefs}
            selectedDivisionKey={selectedDivisionKey}
            selectedDivision={selectedDivision}
            selectedTemplate={selectedTemplate}
            onSelectDivision={onSelectedDivisionKeyChange}
          />
        ) : (
          <section className="panel land-forces-empty">
            Select a country to inspect its land forces.
          </section>
        )}
      </div>
      <footer className="land-forces-note">
        <strong>Current land-force snapshot.</strong>
        <span>
          Manpower completeness uses the backend ratio; strength,
          organization and experience remain raw HOI4 values.
        </span>
      </footer>
    </>
  );
}
