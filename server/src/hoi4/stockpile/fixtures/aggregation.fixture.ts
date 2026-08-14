import type {
  EquipmentDefinitionRecord,
  EquipmentRef,
  NationalStockpileRecord,
} from '../stockpile.types';

interface EquipmentFixtureOptions {
  id: number;
  type?: number;
  definition: string;
  name?: string | null;
  version?: number | null;
  creatorTag?: string | null;
  originTag?: string | null;
  obsolete?: boolean;
  sourceOffset?: number;
}

interface StockpileFixtureOptions {
  countryTag: string;
  equipment?: EquipmentDefinitionRecord | null;
  equipmentRef?: EquipmentRef | null;
  amount: number | null;
  sourceOffset?: number;
  warnings?: string[];
}

export function createEquipmentFixture({
  id,
  type = 70,
  definition,
  name = null,
  version = null,
  creatorTag = null,
  originTag = null,
  obsolete = false,
  sourceOffset = id,
}: EquipmentFixtureOptions): EquipmentDefinitionRecord {
  return {
    equipmentRef: { id, type },
    definition,
    name,
    version,
    maxVersion: null,
    parentEquipmentRef: null,
    creatorTag,
    originTag,
    obsolete,
    isFrame: null,
    designTeamRef: null,
    sourceOffset,
    warnings: [],
  };
}

export function createStockpileFixture({
  countryTag,
  equipment = null,
  equipmentRef = equipment?.equipmentRef ?? null,
  amount,
  sourceOffset = 0,
  warnings = [],
}: StockpileFixtureOptions): NationalStockpileRecord {
  return {
    countryTag,
    equipmentRef,
    amount,
    equipment,
    sourceOffset,
    warnings,
  };
}
