export interface NumericDiff {
  before: number | null;
  after: number | null;
  delta: number | null;
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
}
