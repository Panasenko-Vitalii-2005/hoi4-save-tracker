export interface EquipmentRef {
  id: number;
  type: number;
}

export interface EquipmentDefinitionRecord {
  equipmentRef: EquipmentRef;
  definition: string;
  name: string | null;
  version: number | null;
  maxVersion: number | null;
  parentEquipmentRef: EquipmentRef | null;
  creatorTag: string | null;
  originTag: string | null;
  obsolete: boolean;
  isFrame: boolean | null;
  designTeamRef: EquipmentRef | null;
  sourceOffset: number;
  warnings: string[];
}

export interface EquipmentRegistryParseResult {
  records: EquipmentDefinitionRecord[];
  duplicateReferences: EquipmentRef[];
  warnings: string[];
}

export interface NationalStockpileRecord {
  countryTag: string;
  equipmentRef: EquipmentRef | null;
  amount: number | null;
  equipment: EquipmentDefinitionRecord | null;
  sourceOffset: number;
  warnings: string[];
}

export interface StockpileVariantSummary {
  equipmentRef: EquipmentRef;
  definition: string;
  variantName: string | null;
  amount: number;
  version: number | null;
  creatorTag: string | null;
  originTag: string | null;
  obsolete: boolean;
}

export interface UnresolvedStockpileVariantSummary {
  equipmentRef: EquipmentRef | null;
  amount: number;
}

export interface StockpileDefinitionSummary {
  definition: string;
  amount: number;
  variants: StockpileVariantSummary[];
}

export interface CountryStockpileSummary {
  countryTag: string;
  definitions: StockpileDefinitionSummary[];
  unresolvedVariants: UnresolvedStockpileVariantSummary[];
}

export function equipmentRefKey(reference: EquipmentRef): string {
  return `${reference.type}:${reference.id}`;
}
