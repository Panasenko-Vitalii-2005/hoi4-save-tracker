import type { EquipmentRef } from '../stockpile/stockpile.types';
import type {
  CountryMilitaryProductionSummary,
  MilitaryProductionDefinitionSummary,
  MilitaryProductionLineSummary,
  ParsedMilitaryProductionLine,
  ProductionResourceShortage,
} from './production.types';

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

function compareLines(
  left: MilitaryProductionLineSummary,
  right: MilitaryProductionLineSummary,
): number {
  const byActive =
    right.effectiveActiveFactories - left.effectiveActiveFactories;
  if (byActive !== 0) return byActive;

  const byRequested =
    (right.requestedFactories ?? 0) - (left.requestedFactories ?? 0);
  if (byRequested !== 0) return byRequested;

  const byName = compareNullableStrings(left.variantName, right.variantName);
  if (byName !== 0) return byName;

  const byLineReference = compareNullableReferences(
    left.lineRef,
    right.lineRef,
  );
  if (byLineReference !== 0) return byLineReference;

  return left.sourceOffset - right.sourceOffset;
}

function cloneReference(reference: EquipmentRef | null): EquipmentRef | null {
  return reference === null ? null : { ...reference };
}

function isFiniteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: number | null): value is number {
  return isFiniteNumber(value) && value > 0;
}

function sumNumbers(values: readonly number[]): number {
  return [...values]
    .sort((left, right) => left - right)
    .reduce((total, value) => total + value, 0);
}

function deriveEfficiencies(
  record: ParsedMilitaryProductionLine,
  warnings: string[],
): Pick<
  MilitaryProductionLineSummary,
  'activeEfficiencyAverage' | 'activeEfficiencyMin' | 'activeEfficiencyMax'
> {
  const activeFactories = record.activeFactories;
  if (
    activeFactories === null ||
    !Number.isFinite(activeFactories) ||
    activeFactories <= 0
  ) {
    return {
      activeEfficiencyAverage: null,
      activeEfficiencyMin: null,
      activeEfficiencyMax: null,
    };
  }

  const activeSlotCount = Math.floor(activeFactories);
  if (activeSlotCount !== activeFactories) {
    warnings.push(
      `non-integer active factory count: ${activeFactories}; used ${activeSlotCount} efficiency slots`,
    );
  }

  const activeValues = record.factoryEfficiencies
    .slice(0, activeSlotCount)
    .filter(Number.isFinite);
  if (activeValues.length < activeSlotCount) {
    warnings.push(
      `incomplete active efficiency coverage: expected ${activeSlotCount}, found ${activeValues.length}`,
    );
  }
  if (activeValues.length === 0) {
    return {
      activeEfficiencyAverage: null,
      activeEfficiencyMin: null,
      activeEfficiencyMax: null,
    };
  }

  return {
    activeEfficiencyAverage: sumNumbers(activeValues) / activeValues.length,
    activeEfficiencyMin: Math.min(...activeValues),
    activeEfficiencyMax: Math.max(...activeValues),
  };
}

function deriveResourceShortages(
  record: ParsedMilitaryProductionLine,
): ProductionResourceShortage[] {
  return record.resources
    .filter(
      (resource): resource is typeof resource & { need: number } =>
        resource.need !== null &&
        Number.isFinite(resource.need) &&
        resource.need > 0,
    )
    .map(({ resource, amount, need }) => ({ resource, amount, need }));
}

function deriveLine(
  record: ParsedMilitaryProductionLine,
): MilitaryProductionLineSummary {
  const warnings = [...record.warnings];
  const efficiencies = deriveEfficiencies(record, warnings);
  const resourceShortages = deriveResourceShortages(record);
  const validCost = isPositiveFiniteNumber(record.cost) ? record.cost : null;
  const currentItemsPerDay =
    validCost !== null && isPositiveFiniteNumber(record.speed)
      ? record.speed / validCost
      : null;
  const progressFraction =
    validCost !== null && isFiniteNumber(record.produced)
      ? record.produced / validCost
      : null;

  return {
    countryTag: record.countryTag,
    lineRef: cloneReference(record.lineRef),
    equipmentRef: cloneReference(record.equipmentRef),
    equipmentDefinition: record.equipment?.definition ?? null,
    variantName: record.equipment?.name ?? null,
    version: record.equipment?.version ?? null,
    creatorTag: record.equipment?.creatorTag ?? null,
    originTag: record.equipment?.originTag ?? null,
    obsolete: record.equipment?.obsolete ?? null,
    priority: record.priority,
    requestedFactories: record.requestedFactories,
    activeFactories: record.activeFactories,
    queuedFactories: record.queuedFactories,
    damagedFactories: record.damagedFactories,
    effectiveActiveFactories: record.activeFactories ?? 0,
    effectiveQueuedFactories: record.queuedFactories ?? 0,
    effectiveDamagedFactories: record.damagedFactories ?? 0,
    currentItemsPerDay,
    progressFraction,
    ...efficiencies,
    hasResourceShortage: resourceShortages.length > 0,
    resourceShortages,
    industrialManufacturerRef: cloneReference(record.industrialManufacturerRef),
    sourceOffset: record.sourceOffset,
    complete: record.complete && warnings.length === 0,
    warnings,
  };
}

function factoryTotal(
  lines: readonly MilitaryProductionLineSummary[],
  field:
    | 'requestedFactories'
    | 'effectiveActiveFactories'
    | 'effectiveQueuedFactories'
    | 'effectiveDamagedFactories',
): number {
  return sumNumbers(
    lines.map((line) => {
      const value = line[field];
      return value ?? 0;
    }),
  );
}

function buildDefinitionSummary(
  equipmentDefinition: string,
  lines: MilitaryProductionLineSummary[],
): MilitaryProductionDefinitionSummary {
  lines.sort(compareLines);
  const knownOutputs = lines.flatMap(({ currentItemsPerDay }) =>
    currentItemsPerDay === null ? [] : [currentItemsPerDay],
  );
  const knownCurrentItemsPerDay = sumNumbers(knownOutputs);
  const outputComplete = knownOutputs.length === lines.length;

  return {
    equipmentDefinition,
    lineCount: lines.length,
    requestedFactories: factoryTotal(lines, 'requestedFactories'),
    activeFactories: factoryTotal(lines, 'effectiveActiveFactories'),
    queuedFactories: factoryTotal(lines, 'effectiveQueuedFactories'),
    damagedFactories: factoryTotal(lines, 'effectiveDamagedFactories'),
    currentItemsPerDay: outputComplete ? knownCurrentItemsPerDay : null,
    knownCurrentItemsPerDay,
    outputComplete,
    resourceShortageLineCount: lines.filter(
      ({ hasResourceShortage }) => hasResourceShortage,
    ).length,
    lines,
  };
}

function buildCountrySummary(
  countryTag: string,
  records: readonly ParsedMilitaryProductionLine[],
): CountryMilitaryProductionSummary {
  const definitions = new Map<string, MilitaryProductionLineSummary[]>();
  const unresolvedLines: MilitaryProductionLineSummary[] = [];
  const allLines = records.map(deriveLine);

  for (const line of allLines) {
    if (line.equipmentDefinition === null) {
      unresolvedLines.push(line);
      continue;
    }
    const definitionLines = definitions.get(line.equipmentDefinition) ?? [];
    definitionLines.push(line);
    definitions.set(line.equipmentDefinition, definitionLines);
  }

  const definitionSummaries = [...definitions.entries()]
    .map(([definition, lines]) => buildDefinitionSummary(definition, lines))
    .sort((left, right) =>
      compareStrings(left.equipmentDefinition, right.equipmentDefinition),
    );
  unresolvedLines.sort(compareLines);

  return {
    countryTag,
    lineCount: allLines.length,
    definitionCount: definitionSummaries.length,
    requestedFactories: factoryTotal(allLines, 'requestedFactories'),
    activeFactories: factoryTotal(allLines, 'effectiveActiveFactories'),
    queuedFactories: factoryTotal(allLines, 'effectiveQueuedFactories'),
    damagedFactories: factoryTotal(allLines, 'effectiveDamagedFactories'),
    resourceShortageLineCount: allLines.filter(
      ({ hasResourceShortage }) => hasResourceShortage,
    ).length,
    definitions: definitionSummaries,
    unresolvedLines,
  };
}

export function aggregateMilitaryProduction(
  records: readonly ParsedMilitaryProductionLine[],
): CountryMilitaryProductionSummary[] {
  const countries = new Map<string, ParsedMilitaryProductionLine[]>();

  for (const record of records) {
    const countryRecords = countries.get(record.countryTag) ?? [];
    countryRecords.push(record);
    countries.set(record.countryTag, countryRecords);
  }

  return [...countries.entries()]
    .map(([countryTag, countryRecords]) =>
      buildCountrySummary(countryTag, countryRecords),
    )
    .sort((left, right) => compareStrings(left.countryTag, right.countryTag));
}
