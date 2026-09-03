export interface NumericDiff {
  before: number | null;
  after: number | null;
  delta: number | null;
}

export type SnapshotPresence = 'both' | 'base_only' | 'target_only';

export interface StockpileDefinitionComparison {
  presence: SnapshotPresence;
  balance: NumericDiff;
}

export interface ProductionRateComparison extends NumericDiff {
  baseComplete: boolean | null;
  targetComplete: boolean | null;
  baseKnown: number | null;
  targetKnown: number | null;
}

export interface ProductionDefinitionComparison {
  presence: SnapshotPresence;
  activeFactories: NumericDiff;
  currentItemsPerDay: ProductionRateComparison;
}

export interface EquipmentDefinitionComparison {
  equipmentDefinition: string;
  hasChanges: boolean;
  stockpile: StockpileDefinitionComparison | null;
  production: ProductionDefinitionComparison | null;
}

export interface CountryEquipmentProductionComparison {
  countryTag: string;
  hasChanges: boolean;
  definitions: EquipmentDefinitionComparison[];
}

export interface CountryComparison {
  tag: string;
  // Identity continuity, not equality of all metrics.
  status: 'unchanged' | 'added' | 'removed';
  hasChanges: boolean;
  effectiveMilitaryFactories: NumericDiff;
  effectiveCivilianFactories: NumericDiff;
  effectiveDockyards: NumericDiff;
  divisions: NumericDiff;
  manpowerInField: NumericDiff;
  ships: NumericDiff;
  calculatedWarCasualtiesTotal: NumericDiff;
}

export interface AnalysisComparisonDto {
  baseHash: string;
  targetHash: string;
  baseGameDate: string | null;
  targetGameDate: string | null;
  context: {
    chronology:
      'target_after_base' | 'same_date' | 'target_before_base' | 'unknown';
    sameAnalysis: boolean;
    campaignCompatibility: 'same' | 'different' | 'unknown';
    gameVersionCompatibility: 'same' | 'different' | 'unknown';
  };
  hasChanges: boolean;
  summary: {
    activeCountries: NumericDiff;
    divisions: NumericDiff;
    manpowerInField: NumericDiff;
    aircraft: NumericDiff;
    ships: NumericDiff;
    navalLossCount: NumericDiff;
  };
  countries: CountryComparison[];
  equipmentProduction: CountryEquipmentProductionComparison[];
}
