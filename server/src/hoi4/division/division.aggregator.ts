import {
  equipmentRefKey,
  type EquipmentDefinitionRecord,
  type EquipmentRef,
} from '../stockpile/stockpile.types';
import type {
  CountryDivisionSummary,
  DivisionEquipmentRecord,
  DivisionRecord,
  DivisionTemplateRecord,
  ResolvedDivisionSummary,
} from './division.types';

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareNullableStrings(
  left: string | null,
  right: string | null,
): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return compareStrings(left, right);
}

function compareNullableReferences(
  left: EquipmentRef | null,
  right: EquipmentRef | null,
): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  const byType = left.type - right.type;
  return byType !== 0 ? byType : left.id - right.id;
}

function compareDivisions(
  left: ResolvedDivisionSummary,
  right: ResolvedDivisionSummary,
): number {
  const byName = compareNullableStrings(left.overrideName, right.overrideName);
  if (byName !== 0) return byName;
  const byReference = compareNullableReferences(
    left.divisionRef,
    right.divisionRef,
  );
  return byReference !== 0
    ? byReference
    : left.sourceOffset - right.sourceOffset;
}

function cloneReference(reference: EquipmentRef | null): EquipmentRef | null {
  return reference === null ? null : { ...reference };
}

function cloneEquipmentDefinition(
  equipment: EquipmentDefinitionRecord,
): EquipmentDefinitionRecord {
  return {
    ...equipment,
    equipmentRef: { ...equipment.equipmentRef },
    parentEquipmentRef: cloneReference(equipment.parentEquipmentRef),
    designTeamRef: cloneReference(equipment.designTeamRef),
    warnings: [...equipment.warnings],
  };
}

function cloneEquipmentRecord(
  record: DivisionEquipmentRecord,
): DivisionEquipmentRecord {
  return {
    ...record,
    equipmentRef: cloneReference(record.equipmentRef),
    equipment:
      record.equipment === null
        ? null
        : cloneEquipmentDefinition(record.equipment),
    warnings: [...record.warnings],
  };
}

function cloneTemplate(
  template: DivisionTemplateRecord,
): DivisionTemplateRecord {
  return {
    ...template,
    templateRef: cloneReference(template.templateRef),
    regiments: template.regiments.map((slot) => ({
      ...slot,
      warnings: [...slot.warnings],
    })),
    supportCompanies: template.supportCompanies.map((slot) => ({
      ...slot,
      warnings: [...slot.warnings],
    })),
    regimentalSupport: template.regimentalSupport.map((slot) => ({
      ...slot,
      warnings: [...slot.warnings],
    })),
    warnings: [...template.warnings],
  };
}

function isFiniteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function sumNumbers(values: readonly number[]): number {
  return [...values]
    .sort((left, right) => left - right)
    .reduce((total, value) => total + value, 0);
}

function buildTemplateIndex(
  templates: readonly DivisionTemplateRecord[],
): ReadonlyMap<string, DivisionTemplateRecord[]> {
  const index = new Map<string, DivisionTemplateRecord[]>();
  for (const template of templates) {
    if (template.templateRef === null) continue;
    const key = equipmentRefKey(template.templateRef);
    const matches = index.get(key) ?? [];
    matches.push(template);
    index.set(key, matches);
  }
  for (const matches of index.values()) {
    matches.sort((left, right) => left.sourceOffset - right.sourceOffset);
  }
  return index;
}

function resolveDivision(
  division: DivisionRecord,
  templateIndex: ReadonlyMap<string, DivisionTemplateRecord[]>,
): ResolvedDivisionSummary {
  const warnings = [...division.warnings];
  let template: DivisionTemplateRecord | null = null;

  if (division.divisionTemplateRef === null) {
    warnings.push('missing division template reference');
  } else {
    const key = equipmentRefKey(division.divisionTemplateRef);
    const matches = templateIndex.get(key) ?? [];
    if (matches.length === 0) {
      warnings.push(`unresolved division template reference: ${key}`);
    } else {
      template = cloneTemplate(matches[0]);
      if (matches.length > 1) {
        warnings.push(
          `ambiguous division template reference: ${key}; using source offset ${matches[0].sourceOffset}`,
        );
      }
      if (!matches[0].complete) {
        warnings.push(`resolved division template is partial: ${key}`);
      }
    }
  }

  const currentManpower = division.manpower.current;
  const requiredManpower = division.manpower.required;
  const hasValidManpower =
    isFiniteNumber(currentManpower) && isFiniteNumber(requiredManpower);
  const missingManpower = hasValidManpower
    ? Math.max(requiredManpower - currentManpower, 0)
    : null;
  const manpowerCompleteness =
    hasValidManpower && requiredManpower > 0
      ? currentManpower / requiredManpower
      : null;
  const supplyRatio =
    isFiniteNumber(division.supply.current) &&
    isFiniteNumber(division.supply.max) &&
    division.supply.max > 0
      ? division.supply.current / division.supply.max
      : null;

  return {
    countryTag: division.countryTag,
    divisionRef: cloneReference(division.divisionRef),
    logicalCountryTag: division.logicalCountryTag,
    expeditionaryOwnerTag: division.expeditionaryOwnerTag,
    overrideName: division.name.overrideName,
    nameType: division.name.type,
    nameOrder: division.name.order,
    divisionTemplateRef: cloneReference(division.divisionTemplateRef),
    template,
    currentManpower,
    requiredManpower,
    currentManpowerTag: division.manpower.currentTag,
    requiredManpowerTag: division.manpower.requiredTag,
    missingManpower,
    manpowerCompleteness,
    strength: division.strength,
    organization: division.organization,
    experience: division.experience,
    equipment: division.equipment.map(cloneEquipmentRecord),
    provinceId: division.provinceId,
    supply: { ...division.supply },
    supplyRatio,
    fuel: division.fuel,
    fuelRequested: division.fuelRequested,
    status: { ...division.status },
    sourceOffset: division.sourceOffset,
    complete:
      division.complete &&
      warnings.length === 0 &&
      (template?.complete ?? false),
    warnings,
  };
}

function buildCountrySummary(
  countryTag: string,
  divisions: ResolvedDivisionSummary[],
): CountryDivisionSummary {
  divisions.sort(compareDivisions);
  const validCurrentManpower = divisions.flatMap(({ currentManpower }) =>
    isFiniteNumber(currentManpower) ? [currentManpower] : [],
  );
  const validRequiredManpower = divisions.flatMap(({ requiredManpower }) =>
    isFiniteNumber(requiredManpower) ? [requiredManpower] : [],
  );
  const validMissingManpower = divisions.flatMap(({ missingManpower }) =>
    isFiniteNumber(missingManpower) ? [missingManpower] : [],
  );

  return {
    countryTag,
    divisionCount: divisions.length,
    resolvedTemplateCount: divisions.filter(({ template }) => template !== null)
      .length,
    unresolvedTemplateCount: divisions.filter(
      ({ template }) => template === null,
    ).length,
    currentManpowerTotal: sumNumbers(validCurrentManpower),
    requiredManpowerTotal: sumNumbers(validRequiredManpower),
    missingManpowerTotal: sumNumbers(validMissingManpower),
    fullManpowerDivisionCount: divisions.filter(
      ({ currentManpower, requiredManpower }) =>
        isFiniteNumber(currentManpower) &&
        isFiniteNumber(requiredManpower) &&
        currentManpower === requiredManpower,
    ).length,
    underManpowerDivisionCount: divisions.filter(
      ({ currentManpower, requiredManpower }) =>
        isFiniteNumber(currentManpower) &&
        isFiniteNumber(requiredManpower) &&
        currentManpower < requiredManpower,
    ).length,
    divisions,
  };
}

export function aggregateDivisions(
  divisions: readonly DivisionRecord[],
  templates: readonly DivisionTemplateRecord[],
): CountryDivisionSummary[] {
  const templateIndex = buildTemplateIndex(templates);
  const countries = new Map<string, ResolvedDivisionSummary[]>();

  for (const division of divisions) {
    const countryDivisions = countries.get(division.countryTag) ?? [];
    countryDivisions.push(resolveDivision(division, templateIndex));
    countries.set(division.countryTag, countryDivisions);
  }

  return [...countries.entries()]
    .map(([countryTag, countryDivisions]) =>
      buildCountrySummary(countryTag, countryDivisions),
    )
    .sort((left, right) => compareStrings(left.countryTag, right.countryTag));
}
