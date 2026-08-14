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

export function equipmentRefKey(reference: EquipmentRef): string {
  return `${reference.type}:${reference.id}`;
}
