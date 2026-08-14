import {
  equipmentRefKey,
  type CountryStockpileSummary,
  type EquipmentDefinitionRecord,
  type EquipmentRef,
  type NationalStockpileRecord,
  type StockpileDefinitionSummary,
  type StockpileVariantSummary,
  type UnresolvedStockpileVariantSummary,
} from './stockpile.types';

interface VariantAccumulator {
  equipmentRef: EquipmentRef;
  amounts: number[];
  metadataCandidates: EquipmentDefinitionRecord[];
}

interface CountryAccumulator {
  variants: Map<string, VariantAccumulator>;
  unidentifiedAmounts: number[];
}

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

function compareNullableNumbers(
  left: number | null,
  right: number | null,
): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return left - right;
}

function sumAmounts(amounts: number[]): number {
  return [...amounts]
    .sort((left, right) => left - right)
    .reduce((total, amount) => total + amount, 0);
}

function compareMetadata(
  left: EquipmentDefinitionRecord,
  right: EquipmentDefinitionRecord,
): number {
  const bySource = left.sourceOffset - right.sourceOffset;
  if (bySource !== 0) return bySource;

  const fields = [
    compareStrings(left.definition, right.definition),
    compareNullableStrings(left.name, right.name),
    compareNullableNumbers(left.version, right.version),
    compareNullableStrings(left.creatorTag, right.creatorTag),
    compareNullableStrings(left.originTag, right.originTag),
    Number(left.obsolete) - Number(right.obsolete),
  ];
  return fields.find((comparison) => comparison !== 0) ?? 0;
}

function compareVariants(
  left: StockpileVariantSummary,
  right: StockpileVariantSummary,
): number {
  const byAmount = right.amount - left.amount;
  if (byAmount !== 0) return byAmount;

  const byName = compareNullableStrings(left.variantName, right.variantName);
  if (byName !== 0) return byName;

  const byType = left.equipmentRef.type - right.equipmentRef.type;
  if (byType !== 0) return byType;
  return left.equipmentRef.id - right.equipmentRef.id;
}

function compareUnresolvedVariants(
  left: UnresolvedStockpileVariantSummary,
  right: UnresolvedStockpileVariantSummary,
): number {
  const byAmount = right.amount - left.amount;
  if (byAmount !== 0) return byAmount;
  if (left.equipmentRef === null) {
    return right.equipmentRef === null ? 0 : 1;
  }
  if (right.equipmentRef === null) return -1;

  const byType = left.equipmentRef.type - right.equipmentRef.type;
  if (byType !== 0) return byType;
  return left.equipmentRef.id - right.equipmentRef.id;
}

function createCountryAccumulator(): CountryAccumulator {
  return {
    variants: new Map(),
    unidentifiedAmounts: [],
  };
}

function buildResolvedVariant(
  accumulator: VariantAccumulator,
): StockpileVariantSummary {
  const metadata = [...accumulator.metadataCandidates].sort(compareMetadata)[0];

  return {
    equipmentRef: { ...accumulator.equipmentRef },
    definition: metadata.definition,
    variantName: metadata.name,
    amount: sumAmounts(accumulator.amounts),
    version: metadata.version,
    creatorTag: metadata.creatorTag,
    originTag: metadata.originTag,
    obsolete: metadata.obsolete,
  };
}

function buildCountrySummary(
  countryTag: string,
  accumulator: CountryAccumulator,
): CountryStockpileSummary {
  const definitions = new Map<string, StockpileVariantSummary[]>();
  const unresolvedVariants: UnresolvedStockpileVariantSummary[] = [];
  for (const variantAccumulator of accumulator.variants.values()) {
    if (variantAccumulator.metadataCandidates.length === 0) {
      unresolvedVariants.push({
        equipmentRef: { ...variantAccumulator.equipmentRef },
        amount: sumAmounts(variantAccumulator.amounts),
      });
      continue;
    }

    const resolvedVariant = buildResolvedVariant(variantAccumulator);
    const variants = definitions.get(resolvedVariant.definition) ?? [];
    variants.push(resolvedVariant);
    definitions.set(resolvedVariant.definition, variants);
  }

  const definitionSummaries: StockpileDefinitionSummary[] = [
    ...definitions.entries(),
  ]
    .map(([definition, variants]) => {
      variants.sort(compareVariants);
      return {
        definition,
        amount: sumAmounts(variants.map(({ amount }) => amount)),
        variants,
      };
    })
    .sort((left, right) => compareStrings(left.definition, right.definition));

  unresolvedVariants.push(
    ...accumulator.unidentifiedAmounts.map((amount) => ({
      equipmentRef: null,
      amount,
    })),
  );
  unresolvedVariants.sort(compareUnresolvedVariants);

  return {
    countryTag,
    definitions: definitionSummaries,
    unresolvedVariants,
  };
}

export function aggregateNationalStockpile(
  records: readonly NationalStockpileRecord[],
): CountryStockpileSummary[] {
  const countries = new Map<string, CountryAccumulator>();

  for (const record of records) {
    if (record.amount === null) continue;

    const country =
      countries.get(record.countryTag) ?? createCountryAccumulator();
    countries.set(record.countryTag, country);

    if (record.equipmentRef === null) {
      country.unidentifiedAmounts.push(record.amount);
      continue;
    }

    const referenceKey = equipmentRefKey(record.equipmentRef);
    const variant = country.variants.get(referenceKey) ?? {
      equipmentRef: { ...record.equipmentRef },
      amounts: [],
      metadataCandidates: [],
    };
    variant.amounts.push(record.amount);
    if (record.equipment !== null) {
      variant.metadataCandidates.push(record.equipment);
    }
    country.variants.set(referenceKey, variant);
  }

  return [...countries.entries()]
    .map(([countryTag, accumulator]) =>
      buildCountrySummary(countryTag, accumulator),
    )
    .sort((left, right) => compareStrings(left.countryTag, right.countryTag));
}
