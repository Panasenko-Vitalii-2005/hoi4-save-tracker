import type {
  EquipmentDefinitionRecord,
  EquipmentRef,
} from '../stockpile/stockpile.types';

export interface ProductionResourceRecord {
  resource: string | null;
  amount: number | null;
  need: number | null;
  warnings: string[];
}

export interface ParsedMilitaryProductionLine {
  countryTag: string;
  lineRef: EquipmentRef | null;
  equipmentRef: EquipmentRef | null;
  equipment: EquipmentDefinitionRecord | null;
  priority: number | null;
  amount: number | null;
  requestedFactories: number | null;
  activeFactories: number | null;
  queuedFactories: number | null;
  damagedFactories: number | null;
  produced: number | null;
  speed: number | null;
  cost: number | null;
  factoryEfficiencies: number[];
  resources: ProductionResourceRecord[];
  industrialManufacturerRef: EquipmentRef | null;
  sourceOffset: number;
  complete: boolean;
  warnings: string[];
}

export interface ProductionResourceShortage {
  resource: string | null;
  amount: number | null;
  need: number;
}

export interface MilitaryProductionLineSummary {
  countryTag: string;
  lineRef: EquipmentRef | null;
  equipmentRef: EquipmentRef | null;
  equipmentDefinition: string | null;
  variantName: string | null;
  version: number | null;
  creatorTag: string | null;
  originTag: string | null;
  obsolete: boolean | null;
  priority: number | null;
  requestedFactories: number | null;
  activeFactories: number | null;
  queuedFactories: number | null;
  damagedFactories: number | null;
  effectiveActiveFactories: number;
  effectiveQueuedFactories: number;
  effectiveDamagedFactories: number;
  currentItemsPerDay: number | null;
  progressFraction: number | null;
  activeEfficiencyAverage: number | null;
  activeEfficiencyMin: number | null;
  activeEfficiencyMax: number | null;
  hasResourceShortage: boolean;
  resourceShortages: ProductionResourceShortage[];
  industrialManufacturerRef: EquipmentRef | null;
  sourceOffset: number;
  complete: boolean;
  warnings: string[];
}

export interface MilitaryProductionDefinitionSummary {
  equipmentDefinition: string;
  lineCount: number;
  requestedFactories: number;
  activeFactories: number;
  queuedFactories: number;
  damagedFactories: number;
  currentItemsPerDay: number | null;
  knownCurrentItemsPerDay: number;
  outputComplete: boolean;
  resourceShortageLineCount: number;
  lines: MilitaryProductionLineSummary[];
}

export interface CountryMilitaryProductionSummary {
  countryTag: string;
  lineCount: number;
  definitionCount: number;
  requestedFactories: number;
  activeFactories: number;
  queuedFactories: number;
  damagedFactories: number;
  resourceShortageLineCount: number;
  definitions: MilitaryProductionDefinitionSummary[];
  unresolvedLines: MilitaryProductionLineSummary[];
}
