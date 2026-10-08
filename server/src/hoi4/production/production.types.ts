import type {
  EquipmentDefinitionRecord,
  EquipmentRef,
} from '../stockpile/stockpile.types';

export interface ProductionResourceRecord {
  resource: string | null;
  /** Saved nominal demand, not current supplied/available quantity. */
  amount: number | null;
  /** Raw saved diagnostic; neither zero nor positive values prove runtime shortage. */
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

/** Legacy name: positive saved need entries only, not verified shortages. */
export interface ProductionResourceShortage {
  resource: string | null;
  /** Saved nominal demand, not current supply. */
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
  /** Legacy name: saved speed / cost, not verified realized output. */
  currentItemsPerDay: number | null;
  progressFraction: number | null;
  activeEfficiencyAverage: number | null;
  activeEfficiencyMin: number | null;
  activeEfficiencyMax: number | null;
  /** Legacy diagnostic: at least one positive saved need, not runtime shortage. */
  hasResourceShortage: boolean;
  resourceShortages: ProductionResourceShortage[];
  industrialManufacturerRef: EquipmentRef | null;
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
  /** Complete sum of saved-derived line rates; null if any rate is unknown. */
  currentItemsPerDay: number | null;
  knownCurrentItemsPerDay: number;
  /** Saved-rate coverage only, not runtime/output validation. */
  outputComplete: boolean;
  /** Legacy count of lines with positive saved need entries. */
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
  /** Legacy count of lines with positive saved need entries. */
  resourceShortageLineCount: number;
  definitions: MilitaryProductionDefinitionSummary[];
  unresolvedLines: MilitaryProductionLineSummary[];
}
