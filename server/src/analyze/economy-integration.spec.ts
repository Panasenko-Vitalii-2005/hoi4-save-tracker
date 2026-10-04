import { parseEconomy } from '../hoi4/economy/economy.parser';
import { economyFixture } from '../hoi4/economy/fixtures/economy.fixture';
import { ECONOMY_RESOURCES } from '../hoi4/economy/economy.types';
import {
  comparisonResult,
  comparisonCountry,
} from './fixtures/analysis-comparison.fixture';
import { compareAnalysisResults } from './analysis-comparison.service';
import { projectSnapshot } from './campaign-snapshot-projection-cache.service';
import {
  projectEconomyLedgers,
  ECONOMY_LEDGER_METRICS,
} from './economy-ledger-projection';

const result = (state: 'A' | 'B' | 'C') =>
  comparisonResult({ economy: parseEconomy(economyFixture(state)) });
const compare = (a: 'A' | 'B' | 'C', b: 'A' | 'B' | 'C') =>
  compareAnalysisResults(a, b, result(a), result(b));
const steel = (a: 'A' | 'B' | 'C', b: 'A' | 'B' | 'C') =>
  compare(a, b)
    .economy!.find((row) => row.countryTag === 'GER')!
    .resources.find((row) => row.resource === 'steel')!;

describe('Economy Compare / compact Trends projections', () => {
  test('projects all six national metrics for all six resources verbatim', () => {
    const source = result('A');
    const ledger = projectEconomyLedgers(source).get('GER')!;
    expect(Object.keys(ledger)).toEqual(ECONOMY_RESOURCES);
    for (const row of source.economy!.countrySummaries.find(
      (country) => country.countryTag === 'GER',
    )!.resources) {
      expect(ledger[row.resource]).toEqual({
        extracted: row.extracted,
        imported: row.imported,
        exportAllocation: row.exportAllocation,
        projectDemand: row.projectDemand,
        productionDemand: row.productionDemand.total,
        serializedBalance: row.serializedBalance,
      });
    }
    expect(ledger.aluminium.exportAllocation).toBe(62.1); // NOT savedExported=56.
    expect(ledger.rubber.imported).toBe(5.57792);
    expect(ledger.rubber.serializedBalance).toBe(9.57792);
    expect(ledger.coal.productionDemand).toBe(467);
  });

  test('A -> B -> C preserves the stabilized change and subject-import mismatch', () => {
    const aToB = compare('A', 'B').economy!.find(
      (country) => country.countryTag === 'GER',
    )!.resources;
    for (const [resource, metric, before, after, delta] of [
      ['tungsten', 'extracted', 12, 118, 106],
      ['tungsten', 'serializedBalance', -95, 1, 96],
      ['chromium', 'extracted', 35, 84, 49],
      ['coal', 'serializedBalance', 48, 159, 111],
    ] as const) {
      expect(aToB.find((row) => row.resource === resource)![metric]).toEqual({
        before,
        after,
        delta,
      });
    }
    expect(steel('A', 'B').extracted).toEqual({
      before: 897,
      after: 1184,
      delta: 287,
    });
    expect(steel('A', 'B').serializedBalance).toEqual({
      before: -64,
      after: 205,
      delta: 269,
    });
    expect(steel('B', 'C').imported).toEqual({
      before: null,
      after: 24,
      delta: null,
    });
    expect(steel('B', 'C').serializedBalance).toEqual({
      before: 205,
      after: 229,
      delta: 24,
    });
    for (const [metric, value] of [
      ['extracted', 1184],
      ['exportAllocation', 178],
      ['projectDemand', 28],
      ['productionDemand', 773],
    ] as const) {
      expect(steel('B', 'C')[metric]).toEqual({
        before: value,
        after: value,
        delta: 0,
      });
    }
    expect(steel('C', 'B').imported).toEqual({
      before: 24,
      after: null,
      delta: null,
    });
    expect(steel('C', 'B').serializedBalance.delta).toBe(-24);
    expect(projectEconomyLedgers(result('C')).get('GER')!.steel.imported).toBe(
      24,
    ); // NOT relation delivered=32.
    expect(
      projectEconomyLedgers(result('A')).get('GER')!.tungsten.extracted,
    ).toBe(12); // NOT +39.2 rights.
  });

  test('same analysis retains zero numeric deltas, nullable absence and identity/context', () => {
    const data = compare('A', 'A');
    expect(data.context.sameAnalysis).toBe(true);
    expect(data.context.chronology).toBe('same_date');
    expect(data.hasChanges).toBe(false);
    for (const country of data.economy!)
      for (const row of country.resources)
        for (const metric of ECONOMY_LEDGER_METRICS) {
          expect(row[metric].delta).toBe(
            row[metric].before === null ? null : 0,
          );
        }
  });

  test('legacy, missing country/resource, zero and non-finite values never become fabricated deltas', () => {
    const before = result('C');
    const after = result('C');
    const row = after.economy!.countrySummaries[0].resources.find(
      (r) => r.resource === 'steel',
    )!;
    row.imported = 0;
    row.extracted = NaN;
    const data = compareAnalysisResults('a', 'b', before, after);
    const steelRow = data.economy![0].resources.find(
      (r) => r.resource === 'steel',
    )!;
    expect(steelRow.imported).toEqual({ before: 24, after: 0, delta: -24 });
    expect(steelRow.extracted).toEqual({
      before: 1184,
      after: null,
      delta: null,
    });
    const legacy = compareAnalysisResults('a', 'b', comparisonResult(), before);
    expect(legacy.economy![0].resources[0].extracted.before).toBeNull();
    expect(legacy.economy![0].resources[0].extracted.delta).toBeNull();
    expect(legacy.countries[0].hasChanges).toBe(true);
    expect(
      compareAnalysisResults('a', 'b', comparisonResult(), comparisonResult())
        .economy,
    ).toEqual([]);
    after.economy!.countrySummaries[0].resources = [];
    expect(projectEconomyLedgers(after).get('GER')!.steel.imported).toBeNull();
    after.economy!.countrySummaries = [];
    expect(projectEconomyLedgers(after).has('GER')).toBe(false);
  });

  test('Economy-only changes are discoverable without changing Added/Removed country matching', () => {
    const a = result('A');
    const b = result('B');
    const data = compareAnalysisResults('a', 'b', a, b);
    expect(data.countries[0]).toMatchObject({
      tag: 'GER',
      status: 'unchanged',
      hasChanges: true,
    });
    b.by_country = [comparisonCountry('POR')];
    expect(
      compareAnalysisResults('a', 'b', a, b).countries.map(
        ({ tag, status }) => [tag, status],
      ),
    ).toEqual([
      ['GER', 'removed'],
      ['POR', 'added'],
    ]);
  });

  test('Trends cache stores national ledgers only, preserves missing legacy and per-country gaps', () => {
    const context = {
      campaignId: 'fixture',
      gameVersion: '1.19.2',
      playerCountryTag: 'GER',
    };
    const fp = { bytes: 100, mtimeMs: 1, ctimeMs: 1 };
    const a = projectSnapshot('a', result('A'), context, fp);
    const b = projectSnapshot('b', result('B'), context, fp);
    const c = projectSnapshot('c', result('C'), context, fp);
    expect(
      [a, b, c].map(
        (snapshot) => snapshot.countries[0].economy!.steel.serializedBalance,
      ),
    ).toEqual([-64, 205, 229]);
    expect(
      [a, b, c].map(
        (snapshot) => snapshot.countries[0].economy!.steel.imported,
      ),
    ).toEqual([null, null, 24]);
    expect(a.countries[0].economy).not.toHaveProperty('commercialTrades');
    expect(a.countries[0].economy).not.toHaveProperty('resourceRightsOrigins');
    expect(a.metrics).not.toHaveProperty('economy');
    expect(
      projectSnapshot('old', comparisonResult(), context, fp).countries[0],
    ).not.toHaveProperty('economy');
    expect(
      projectSnapshot(
        'missing',
        comparisonResult({ by_country: [] }),
        context,
        fp,
      ).countries,
    ).toEqual([]);
  });
});
