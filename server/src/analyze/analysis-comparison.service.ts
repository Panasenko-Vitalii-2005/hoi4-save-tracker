import { Injectable } from '@nestjs/common';
import type { AnalyzeResult, CountryStats } from '../hoi4/hoi4-parser';
import {
  unknownSaveComparisonContext,
  type SaveComparisonContext,
} from '../hoi4/save-comparison-context';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import type {
  AnalysisComparisonDto,
  CountryEquipmentProductionComparison,
  CountryComparison,
  EquipmentDefinitionComparison,
  NumericDiff,
  SnapshotPresence,
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

function gameDate(value: unknown): readonly [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)\.(\d{1,2})\.(\d{1,2})$/.exec(value);
  if (!match) return null;
  const date = match.slice(1).map(Number) as [number, number, number];
  return date[0] > 0 &&
    date[1] >= 1 &&
    date[1] <= 12 &&
    date[2] >= 1 &&
    date[2] <= 31
    ? date
    : null;
}

function chronology(
  baseDate: unknown,
  targetDate: unknown,
): AnalysisComparisonDto['context']['chronology'] {
  const base = gameDate(baseDate);
  const target = gameDate(targetDate);
  if (!base || !target) return 'unknown';
  for (let index = 0; index < base.length; index++) {
    if (target[index] > base[index]) return 'target_after_base';
    if (target[index] < base[index]) return 'target_before_base';
  }
  return 'same_date';
}

function compatibility(
  before: string | null,
  after: string | null,
): 'same' | 'different' | 'unknown' {
  return before && after
    ? before === after
      ? 'same'
      : 'different'
    : 'unknown';
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function add(left: number | null, right: unknown): number | null {
  const value = finite(right);
  if (left === null || value === null) return null;
  return finite(left + value);
}

function presence(before: boolean, after: boolean): SnapshotPresence {
  return before && after ? 'both' : before ? 'base_only' : 'target_only';
}

function stockpileByCountry(
  result: AnalyzeResult,
): Map<string, Map<string, number | null>> {
  const countries = new Map<string, Map<string, number | null>>();
  for (const country of result.stockpileSummaries ?? []) {
    if (!country || typeof country.countryTag !== 'string') continue;
    const definitions =
      countries.get(country.countryTag) ?? new Map<string, number | null>();
    countries.set(country.countryTag, definitions);
    for (const item of country.definitions ?? []) {
      if (!item || typeof item.definition !== 'string') continue;
      const amount = finite(item.amount);
      definitions.set(
        item.definition,
        definitions.has(item.definition)
          ? add(definitions.get(item.definition) ?? null, amount)
          : amount,
      );
    }
  }
  return countries;
}

interface ProductionSnapshot {
  activeFactories: number | null;
  currentItemsPerDay: number | null;
  knownCurrentItemsPerDay: number | null;
  outputComplete: boolean;
}

function productionByCountry(
  result: AnalyzeResult,
): Map<string, Map<string, ProductionSnapshot>> {
  const countries = new Map<string, Map<string, ProductionSnapshot>>();
  for (const country of result.militaryProductionSummaries ?? []) {
    if (!country || typeof country.countryTag !== 'string') continue;
    const definitions =
      countries.get(country.countryTag) ??
      new Map<string, ProductionSnapshot>();
    countries.set(country.countryTag, definitions);
    for (const item of country.definitions ?? []) {
      if (!item || typeof item.equipmentDefinition !== 'string') continue;
      const nextComplete = item.outputComplete === true;
      const next: ProductionSnapshot = {
        activeFactories: finite(item.activeFactories),
        currentItemsPerDay: nextComplete
          ? finite(item.currentItemsPerDay)
          : null,
        knownCurrentItemsPerDay: finite(item.knownCurrentItemsPerDay),
        outputComplete: nextComplete,
      };
      const current = definitions.get(item.equipmentDefinition);
      definitions.set(
        item.equipmentDefinition,
        current
          ? {
              activeFactories: add(
                current.activeFactories,
                next.activeFactories,
              ),
              currentItemsPerDay:
                current.outputComplete && next.outputComplete
                  ? add(current.currentItemsPerDay, next.currentItemsPerDay)
                  : null,
              knownCurrentItemsPerDay: add(
                current.knownCurrentItemsPerDay,
                next.knownCurrentItemsPerDay,
              ),
              outputComplete: current.outputComplete && next.outputComplete,
            }
          : next,
      );
    }
  }
  return countries;
}

function equipmentDefinitionComparison(
  equipmentDefinition: string,
  baseStockpile: Map<string, number | null> | undefined,
  targetStockpile: Map<string, number | null> | undefined,
  baseProduction: Map<string, ProductionSnapshot> | undefined,
  targetProduction: Map<string, ProductionSnapshot> | undefined,
): EquipmentDefinitionComparison {
  const hasBaseStockpile = baseStockpile?.has(equipmentDefinition) ?? false;
  const hasTargetStockpile = targetStockpile?.has(equipmentDefinition) ?? false;
  const hasBaseProduction = baseProduction?.has(equipmentDefinition) ?? false;
  const hasTargetProduction =
    targetProduction?.has(equipmentDefinition) ?? false;
  const leftProduction = baseProduction?.get(equipmentDefinition);
  const rightProduction = targetProduction?.get(equipmentDefinition);
  const stockpile =
    hasBaseStockpile || hasTargetStockpile
      ? {
          presence: presence(hasBaseStockpile, hasTargetStockpile),
          balance: numericDiff(
            hasBaseStockpile ? baseStockpile?.get(equipmentDefinition) : null,
            hasTargetStockpile
              ? targetStockpile?.get(equipmentDefinition)
              : null,
          ),
        }
      : null;
  const activeFactories = numericDiff(
    leftProduction?.activeFactories,
    rightProduction?.activeFactories,
  );
  const currentItemsPerDay = numericDiff(
    leftProduction?.outputComplete ? leftProduction.currentItemsPerDay : null,
    rightProduction?.outputComplete ? rightProduction.currentItemsPerDay : null,
  );
  const production =
    hasBaseProduction || hasTargetProduction
      ? {
          presence: presence(hasBaseProduction, hasTargetProduction),
          activeFactories,
          currentItemsPerDay: {
            ...currentItemsPerDay,
            baseComplete: leftProduction?.outputComplete ?? null,
            targetComplete: rightProduction?.outputComplete ?? null,
            baseKnown: leftProduction?.knownCurrentItemsPerDay ?? null,
            targetKnown: rightProduction?.knownCurrentItemsPerDay ?? null,
          },
        }
      : null;
  const hasChanges =
    (stockpile !== null &&
      (stockpile.presence !== 'both' || changed(stockpile.balance))) ||
    (production !== null &&
      (production.presence !== 'both' ||
        changed(production.activeFactories) ||
        changed(production.currentItemsPerDay) ||
        production.currentItemsPerDay.baseComplete !==
          production.currentItemsPerDay.targetComplete ||
        production.currentItemsPerDay.baseKnown !==
          production.currentItemsPerDay.targetKnown));
  return {
    equipmentDefinition,
    hasChanges,
    stockpile,
    production,
  };
}

function compareEquipmentProduction(
  base: AnalyzeResult,
  target: AnalyzeResult,
): CountryEquipmentProductionComparison[] {
  const baseStockpile = stockpileByCountry(base);
  const targetStockpile = stockpileByCountry(target);
  const baseProduction = productionByCountry(base);
  const targetProduction = productionByCountry(target);
  const countryTags = new Set([
    ...baseStockpile.keys(),
    ...targetStockpile.keys(),
    ...baseProduction.keys(),
    ...targetProduction.keys(),
  ]);
  return [...countryTags].sort().map((countryTag) => {
    const definitionNames = new Set([
      ...(baseStockpile.get(countryTag)?.keys() ?? []),
      ...(targetStockpile.get(countryTag)?.keys() ?? []),
      ...(baseProduction.get(countryTag)?.keys() ?? []),
      ...(targetProduction.get(countryTag)?.keys() ?? []),
    ]);
    const definitions = [...definitionNames]
      .sort()
      .map((definition) =>
        equipmentDefinitionComparison(
          definition,
          baseStockpile.get(countryTag),
          targetStockpile.get(countryTag),
          baseProduction.get(countryTag),
          targetProduction.get(countryTag),
        ),
      );
    return {
      countryTag,
      hasChanges: definitions.some((definition) => definition.hasChanges),
      definitions,
    };
  });
}

/** Pure snapshot comparison. Missing countries/fields are unknown, never implicit zero. */
export function compareAnalysisResults(
  baseHash: string,
  targetHash: string,
  base: AnalyzeResult,
  target: AnalyzeResult,
  baseContext: SaveComparisonContext = unknownSaveComparisonContext(),
  targetContext: SaveComparisonContext = unknownSaveComparisonContext(),
): AnalysisComparisonDto {
  const equipmentProduction = compareEquipmentProduction(base, target);
  const equipmentChanges = new Map(
    equipmentProduction.map(({ countryTag, hasChanges }) => [
      countryTag,
      hasChanges,
    ]),
  );
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
        hasChanges:
          !left ||
          !right ||
          Object.values(metrics).some(changed) ||
          equipmentChanges.get(tag) === true,
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
    context: {
      chronology: chronology(base.game_date, target.game_date),
      sameAnalysis: baseHash === targetHash,
      campaignCompatibility: compatibility(
        baseContext.campaignId,
        targetContext.campaignId,
      ),
      gameVersionCompatibility: compatibility(
        baseContext.gameVersion,
        targetContext.gameVersion,
      ),
    },
    hasChanges:
      countries.some((country) => country.hasChanges) ||
      equipmentProduction.some((country) => country.hasChanges) ||
      Object.values(summary).some(changed),
    summary,
    countries,
    equipmentProduction,
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
        ? await this.results
            .getWithContext(baseHash)
            .then((result) => [result, result])
        : await Promise.all([
            this.results.getWithContext(baseHash),
            this.results.getWithContext(targetHash),
          ]);
    return base && target
      ? compareAnalysisResults(
          baseHash,
          targetHash,
          base.result,
          target.result,
          base.comparisonContext,
          target.comparisonContext,
        )
      : null;
  }
}
