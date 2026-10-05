import type { AnalyzeResult } from '../../hoi4/hoi4-parser';
import { parseEconomy } from '../../hoi4/economy/economy.parser';
import { economyFixture } from '../../hoi4/economy/fixtures/economy.fixture';
import {
  comparisonCountry,
  comparisonResult,
} from '../fixtures/analysis-comparison.fixture';
import { projectSnapshot } from '../campaign-snapshot-projection-cache.service';
import type { TimeWindow } from './intelligence.types';

export const CAMPAIGN = '0731c3c7-035e-46b1-b07b-6c35b27e8dc2';
export const VERSION = '1.19.2.0.3eb1 (85f4)';
export const hash = (letter: string): string => letter.repeat(64);
export const query = {
  campaignKey: `campaign:${CAMPAIGN}`,
  countryTag: 'GER',
  baseHash: hash('a'),
  targetHash: hash('b'),
};
export function intelligenceResult({
  mil = 10,
  allocation = 2,
  stockpile = 100,
  balance = 43,
  demand = 20,
  definition = 'light_tank_chassis_2',
}: {
  mil?: number;
  allocation?: number;
  stockpile?: number;
  balance?: number;
  demand?: number;
  definition?: string;
} = {}): AnalyzeResult {
  const economy = parseEconomy(economyFixture('A'));
  const steel = economy.countrySummaries[0].resources.find(
    (row) => row.resource === 'steel',
  )!;
  steel.serializedBalance = balance;
  steel.productionDemand.total = demand;
  return comparisonResult({
    by_country: [comparisonCountry('GER', { effectiveMilitaryFactories: mil })],
    economy,
    stockpileSummaries: [
      {
        countryTag: 'GER',
        definitions: [{ definition, amount: stockpile, variants: [] }],
        unresolvedVariants: [],
      },
    ],
    militaryProductionSummaries: [
      {
        countryTag: 'GER',
        lineCount: 1,
        definitionCount: 1,
        requestedFactories: allocation,
        activeFactories: allocation,
        queuedFactories: 0,
        damagedFactories: 0,
        resourceShortageLineCount: 0,
        definitions: [
          {
            equipmentDefinition: definition,
            lineCount: 1,
            requestedFactories: allocation,
            activeFactories: allocation,
            queuedFactories: 0,
            damagedFactories: 0,
            currentItemsPerDay: 10,
            knownCurrentItemsPerDay: 10,
            outputComplete: true,
            resourceShortageLineCount: 0,
            lines: [],
          },
        ],
        unresolvedLines: [],
      },
    ],
  });
}
export function intelligenceSnapshot(
  letter: string,
  result = intelligenceResult(),
  gameDate = '1941.1.1',
) {
  return projectSnapshot(
    hash(letter),
    { ...result, game_date: gameDate },
    { campaignId: CAMPAIGN, gameVersion: VERSION, playerCountryTag: 'GER' },
    { bytes: 1000, mtimeMs: 1, ctimeMs: 1 },
  );
}
export function intelligenceWindow(): TimeWindow {
  return {
    ...query,
    baseGameDate: '1941.1.1',
    targetGameDate: '1942.1.1',
    snapshotHashes: [hash('a'), hash('b')],
    selectionBasis: 'explicit_endpoints_and_strictly_intermediate_game_dates',
    temporalEligible: true,
    suppressionReasons: [],
  };
}
