import { Injectable } from '@nestjs/common';
import type { AnalyzeResult, CountryStats } from '../hoi4/hoi4-parser';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import type {
  AnalysisComparisonDto,
  CountryComparison,
  NumericDiff,
} from './analysis-comparison.types';

export function numericDiff(before: unknown, after: unknown): NumericDiff {
  const finite = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  const left = finite(before);
  const right = finite(after);
  return {
    before: left,
    after: right,
    delta: left !== null && right !== null ? finite(right - left) : null,
  };
}

const changed = (diff: NumericDiff): boolean => diff.before !== diff.after;
const COUNTRY_METRICS = [
  'effectiveMilitaryFactories',
  'effectiveCivilianFactories',
  'effectiveDockyards',
  'divisions',
  'manpowerInField',
  'ships',
  'calculatedWarCasualtiesTotal',
] as const satisfies readonly (keyof CountryStats)[];

/** Pure snapshot comparison. Missing countries/fields are unknown, never implicit zero. */
export function compareAnalysisResults(
  baseHash: string,
  targetHash: string,
  base: AnalyzeResult,
  target: AnalyzeResult,
): AnalysisComparisonDto {
  const index = (result: AnalyzeResult) =>
    new Map(
      result.by_country
        .filter((country) => country && typeof country.tag === 'string')
        .map((country) => [country.tag, country]),
    );
  const before = index(base);
  const after = index(target);
  // Neutral tag order is locale-independent; names are resolved by the existing UI.
  const countries = [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .map((tag): CountryComparison => {
      const left = before.get(tag);
      const right = after.get(tag);
      const metrics = Object.fromEntries(
        COUNTRY_METRICS.map((key) => [
          key,
          numericDiff(left?.[key], right?.[key]),
        ]),
      ) as Pick<CountryComparison, (typeof COUNTRY_METRICS)[number]>;
      return {
        tag,
        status: !left ? 'added' : !right ? 'removed' : 'unchanged',
        hasChanges: !left || !right || Object.values(metrics).some(changed),
        ...metrics,
      };
    });
  const summary: AnalysisComparisonDto['summary'] = {
    activeCountries: numericDiff(
      base.active_countries,
      target.active_countries,
    ),
    divisions: numericDiff(base.totals.divisions, target.totals.divisions),
    manpowerInField: numericDiff(
      base.totals.manpowerInField,
      target.totals.manpowerInField,
    ),
    aircraft: numericDiff(base.totals.aircraft, target.totals.aircraft),
    ships: numericDiff(base.totals.ships, target.totals.ships),
    // Retained event count, NOT necessarily new sinkings between these dates.
    navalLossCount: numericDiff(
      base.navalLosses.length,
      target.navalLosses.length,
    ),
  };
  return {
    baseHash,
    targetHash,
    baseGameDate: base.game_date || null,
    targetGameDate: target.game_date || null,
    hasChanges:
      countries.some((country) => country.hasChanges) ||
      Object.values(summary).some(changed),
    summary,
    countries,
  };
}

@Injectable()
export class AnalysisComparisonService {
  constructor(private readonly results: PersistedAnalysisResultService) {}

  async compare(
    baseHash: string,
    targetHash: string,
  ): Promise<AnalysisComparisonDto | null> {
    // Durable storage is authoritative; do not consult the Worker or completed RAM cache.
    const [base, target] =
      baseHash === targetHash
        ? await this.results.get(baseHash).then((result) => [result, result])
        : await Promise.all([
            this.results.get(baseHash),
            this.results.get(targetHash),
          ]);
    return base && target
      ? compareAnalysisResults(baseHash, targetHash, base, target)
      : null;
  }
}
