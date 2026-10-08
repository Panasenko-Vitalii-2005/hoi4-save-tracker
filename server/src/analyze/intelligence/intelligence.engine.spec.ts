import { parseEconomy } from '../../hoi4/economy/economy.parser';
import { economyFixture } from '../../hoi4/economy/fixtures/economy.fixture';
import { comparisonResult } from '../fixtures/analysis-comparison.fixture';
import { generateIntelligence } from './intelligence.engine';
import { extractSeries } from './observations';
import { METRIC_REGISTRY } from './metric-registry';
import {
  INSIGHT_FAMILIES,
  type CampaignIntelligenceDto,
} from './intelligence.types';
import {
  hash,
  intelligenceResult,
  intelligenceSnapshot,
  intelligenceWindow,
} from './intelligence.fixture';

const run = (
  before = intelligenceResult(),
  after = intelligenceResult({
    mil: 12,
    allocation: 4,
    stockpile: -20,
    balance: -71,
    demand: 30,
  }),
) =>
  generateIntelligence(
    [
      intelligenceSnapshot('a', before),
      intelligenceSnapshot('b', after, '1942.1.1'),
    ],
    intelligenceWindow(),
  );
const ids = (data: CampaignIntelligenceDto) =>
  data.insights.map((row) => row.catalogId);

describe('bounded Campaign Intelligence semantic engine', () => {
  test.each([
    'INDUSTRY_ALLOCATION_EXPANSION',
    'INDUSTRIAL_EXPANSION_WITH_RESOURCE_CROSSING',
    'RESOURCE_PRESSURE_WITH_HIGHER_DEMAND',
    'ALLOCATION_WITH_STOCKPILE_DECLINE',
    'EQUIPMENT_DEFICIT_DURING_ALLOCATION_EXPANSION',
  ] as const)('detects %s with machine-readable evidence', (family) => {
    const data = run();
    expect(ids(data)).toContain(family);
    const insight = data.insights.find((row) => row.catalogId === family)!;
    expect(insight.causalClaim).toBe(false);
    expect(insight.messageKey).toMatch(/^intelligence\./);
    expect(insight.signalIds.length).toBe(2);
    expect(
      insight.evidenceIds.every((key) =>
        data.evidence.some((fact) => fact.id === key),
      ),
    ).toBe(true);
  });

  test.each([20, 21])(
    'resource recovery accepts maintained/increased demand %s',
    (demand) => {
      const data = run(
        intelligenceResult({ balance: -40 }),
        intelligenceResult({ balance: 5, demand }),
      );
      expect(ids(data)).toContain('RESOURCE_RECOVERY_WITH_MAINTAINED_DEMAND');
      expect(
        data.insights.find(
          (row) => row.catalogId === 'RESOURCE_RECOVERY_WITH_MAINTAINED_DEMAND',
        )!.severity,
      ).toBe('informational');
    },
  );
  test('recovery includes a measured zero endpoint; lower demand does not qualify', () => {
    expect(
      ids(
        run(
          intelligenceResult({ balance: -40 }),
          intelligenceResult({ balance: 0 }),
        ),
      ),
    ).toContain('RESOURCE_RECOVERY_WITH_MAINTAINED_DEMAND');
    expect(
      ids(
        run(
          intelligenceResult({ balance: -40 }),
          intelligenceResult({ balance: 5, demand: 19 }),
        ),
      ),
    ).not.toContain('RESOURCE_RECOVERY_WITH_MAINTAINED_DEMAND');
  });
  test('zero -> negative is not positive -> negative crossing', () => {
    const data = run(intelligenceResult({ balance: 0, stockpile: 0 }));
    expect(ids(data)).not.toContain(
      'INDUSTRIAL_EXPANSION_WITH_RESOURCE_CROSSING',
    );
    expect(ids(data)).not.toContain(
      'EQUIPMENT_DEFICIT_DURING_ALLOCATION_EXPANSION',
    );
  });
  test('every family requires both predicates, not just one changing metric', () => {
    const data = run(
      intelligenceResult(),
      intelligenceResult({ balance: -71, stockpile: -20 }),
    );
    expect(data.insights).toEqual([]);
  });
  test.each([
    'economy',
    'stockpileSummaries',
    'militaryProductionSummaries',
  ] as const)('legacy missing %s never becomes zero', (domain) => {
    const before = intelligenceResult();
    delete (before as Partial<typeof before>)[domain];
    const data = run(before);
    const missing = data.series
      .flatMap((row) => row.observations)
      .filter((row) => row.status === 'missing');
    expect(
      missing.some(
        (row) =>
          row.status === 'missing' &&
          row.reason === 'legacy' &&
          row.value === null,
      ),
    ).toBe(true);
    const prefix =
      domain === 'economy'
        ? 'economy.'
        : domain === 'stockpileSummaries'
          ? 'stockpile.'
          : 'production.';
    expect(
      data.summaries
        .filter((row) => row.metric.id.startsWith(prefix))
        .every((row) => row.startValue === null && row.delta === null),
    ).toBe(true);
    expect(
      data.coverageIssues.some((row) => row.code === 'metric_legacy'),
    ).toBe(true);
  });
  test('explicit zero remains observed and zero-baseline percentage is unavailable', () => {
    const data = run(
      intelligenceResult({
        mil: 0,
        allocation: 0,
        stockpile: 0,
        balance: 0,
        demand: 0,
      }),
    );
    for (const summary of data.summaries.filter(
      (row) =>
        row.metric.id === 'industry.effectiveMilitaryFactories' ||
        row.metric.resource === 'steel' ||
        row.metric.equipmentDefinition,
    )) {
      expect(summary.startValue).toBe(0);
      expect(summary.relativeDelta).toBeNull();
    }
    expect(data.series[0].observations[0].status).toBe('observed');
  });
  test('fractional raw values and tiny genuine changes are preserved without an epsilon', () => {
    const data = run(
      intelligenceResult({ stockpile: 5.57792, allocation: 2 }),
      intelligenceResult({ stockpile: 5.57791, allocation: 2.000001 }),
    );
    const summary = data.summaries.find(
      (row) => row.metric.id === 'stockpile.balance',
    )!;
    expect(summary.startValue).toBe(5.57792);
    expect(summary.endValue).toBe(5.57791);
    expect(summary.delta).toBe(5.57791 - 5.57792);
    expect(summary.relativeDelta).toBeNull();
    expect(ids(data)).toContain('ALLOCATION_WITH_STOCKPILE_DECLINE');
    expect(data.evidence.some((row) => row.rawValues.includes(5.57792))).toBe(
      true,
    );
  });
  test('signed crossings carry the observed bracket, not an invented exact crossing date', () => {
    const data = run();
    const crossing = data.signals.find(
      (row) =>
        row.metric.resource === 'steel' && row.type === 'positive_to_negative',
    )!;
    expect(crossing.summary).toMatchObject({
      startValue: 43,
      endValue: -71,
      delta: -114,
      relativeDelta: null,
    });
    expect(crossing.crossingBracket).toEqual({
      beforeHash: hash('a'),
      afterHash: hash('b'),
    });
    expect(crossing).not.toHaveProperty('crossingDate');
  });
  test('no join by variant display name or save-local reference', () => {
    const before = intelligenceResult({ definition: 'tank_a' });
    const after = intelligenceResult({
      definition: 'tank_b',
      allocation: 9,
      stockpile: -5,
    });
    for (const result of [before, after])
      result.stockpileSummaries[0].definitions[0].variants = [
        {
          equipmentRef: { id: 1, type: 70 },
          definition: result.stockpileSummaries[0].definitions[0].definition,
          variantName: 'Same visible name',
          amount: 1,
          version: null,
          creatorTag: null,
          originTag: null,
          obsolete: false,
        },
      ];
    const data = run(before, after);
    expect(ids(data)).not.toContain('ALLOCATION_WITH_STOCKPILE_DECLINE');
    expect(ids(data)).not.toContain(
      'EQUIPMENT_DEFICIT_DURING_ALLOCATION_EXPANSION',
    );
    expect(
      data.summaries
        .filter((row) => row.metric.equipmentDefinition)
        .every((row) => row.delta === null),
    ).toBe(true);
  });
  test('missing resource endpoint suppresses crossing instead of inventing zero', () => {
    const before = intelligenceResult();
    before.economy!.countrySummaries[0].resources.find(
      (row) => row.resource === 'steel',
    )!.serializedBalance = null;
    const data = run(before);
    expect(ids(data)).not.toContain(
      'INDUSTRIAL_EXPANSION_WITH_RESOURCE_CROSSING',
    );
    expect(
      data.summaries.find(
        (row) =>
          row.metric.resource === 'steel' &&
          row.metric.id === 'economy.serializedBalance',
      )!.delta,
    ).toBeNull();
  });
  test('a partial aggregate is explicitly qualified medium confidence, not a probability', () => {
    const data = run();
    const insight = data.insights.find(
      (row) => row.catalogId === 'ALLOCATION_WITH_STOCKPILE_DECLINE',
    )!;
    expect(insight.confidence.level).toBe('medium');
    expect(insight.qualifiers).toContain('aggregate_source_coverage_unknown');
    expect(insight.confidence).not.toHaveProperty('score');
  });
  test('intermediate missing data stays a gap; endpoint insights make no sustained claim', () => {
    const middle = intelligenceSnapshot('c', comparisonResult(), '1941.6.1');
    const data = generateIntelligence(
      [
        intelligenceSnapshot('a'),
        middle,
        intelligenceSnapshot(
          'b',
          intelligenceResult({ balance: -71, mil: 12 }),
          '1942.1.1',
        ),
      ],
      {
        ...intelligenceWindow(),
        snapshotHashes: [hash('a'), hash('c'), hash('b')],
      },
    );
    const series = data.series.find(
      (row) =>
        row.key.id === 'economy.serializedBalance' &&
        row.key.resource === 'steel',
    )!;
    expect(series.observations.map((row) => row.value)).toEqual([
      43,
      null,
      -71,
    ]);
    expect(
      data.signals.find((row) => row.metric.resource === 'steel')!.confidence
        .reasons,
    ).toContain('intermediate_gaps_endpoint_comparison_only');
    expect(data.signals.every((row) => !row.type.includes('sustained'))).toBe(
      true,
    );
  });
  test('all references resolve and results/IDs/order are deterministic', () => {
    const first = run();
    expect(run()).toEqual(first);
    expect(new Set(first.evidence.map((row) => row.id)).size).toBe(
      first.evidence.length,
    );
    for (const row of first.evidence)
      expect(
        row.inputEvidenceIds.every((key) =>
          first.evidence.some((fact) => fact.id === key),
        ),
      ).toBe(true);
    for (const row of first.signals)
      expect(
        row.evidenceIds.every((key) =>
          first.evidence.some((fact) => fact.id === key),
        ),
      ).toBe(true);
    for (const row of first.insights)
      expect(
        row.signalIds.every((key) =>
          first.signals.some((signal) => signal.id === key),
        ),
      ).toBe(true);
    expect(
      first.insights.every((row) => INSIGHT_FAMILIES.includes(row.catalogId)),
    ).toBe(true);
  });
  test('input array ordering and display names do not affect derived IDs', () => {
    const a = intelligenceResult();
    const b = intelligenceResult({ mil: 12, balance: -71 });
    const first = run(a, b);
    a.by_country.reverse();
    b.economy!.countrySummaries[0].resources.reverse();
    expect(run(a, b)).toEqual(first);
  });
  test('registry and engine exclude rates, need, casualties, naval attrition, rights attribution, Oil/Fuel and causation', () => {
    const before = intelligenceResult();
    const after = intelligenceResult({ mil: 12 });
    const baseline = run(before, after);
    before.militaryProductionSummaries[0].resourceShortageLineCount = 99;
    after.militaryProductionSummaries[0].definitions[0].resourceShortageLineCount = 100;
    after.by_country[0].calculatedWarCasualtiesTotal = 999999;
    after.militaryProductionSummaries[0].definitions[0].currentItemsPerDay = 99999;
    const data = run(before, after);
    expect(data).toEqual(baseline);
    expect(Object.keys(METRIC_REGISTRY)).toHaveLength(5);
    expect(
      data.series.every((row) => row.key.resource !== ('oil' as string)),
    ).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(
      /casualt|naval|currentItemsPerDay|need=|forecast|utilization|critical|caused|starvation/i,
    );
    expect(
      data.insights.every(
        (row) => row.causalClaim === false && !('text' in row),
      ),
    ).toBe(true);
    expect(ids(data)).toEqual([]);
  });
  test('overflow arithmetic is null and does not create a signal', () => {
    const data = run(
      intelligenceResult({ stockpile: Number.MAX_VALUE }),
      intelligenceResult({ stockpile: -Number.MAX_VALUE }),
    );
    expect(
      data.summaries.find((row) => row.metric.id === 'stockpile.balance')!
        .delta,
    ).toBeNull();
    expect(ids(data)).not.toContain(
      'EQUIPMENT_DEFICIT_DURING_ALLOCATION_EXPANSION',
    );
  });
  test('invalid direct projected numbers are marked invalid, not zero', () => {
    const snapshot = intelligenceSnapshot('a');
    snapshot.countries[0].metrics.militaryFactories = NaN;
    expect(
      extractSeries([snapshot], 'GER').find(
        (row) => row.key.id === 'industry.effectiveMilitaryFactories',
      )!.observations[0],
    ).toMatchObject({ status: 'missing', reason: 'invalid', value: null });
  });
  test('A/B/C keep real serialized ledgers and summaries separate from trade delivery and rights', () => {
    const snapshots = (['A', 'B', 'C'] as const).map((state, i) =>
      intelligenceSnapshot(
        ['a', 'b', 'c'][i],
        comparisonResult({ economy: parseEconomy(economyFixture(state)) }),
      ),
    );
    const data = generateIntelligence(snapshots, {
      ...intelligenceWindow(),
      targetHash: hash('c'),
      snapshotHashes: snapshots.map((row) => row.hash),
      temporalEligible: false,
      suppressionReasons: ['same_date_chronology_unknown'],
    });
    const values = (resource: 'steel' | 'tungsten') =>
      data.series
        .find(
          (row) =>
            row.key.id === 'economy.serializedBalance' &&
            row.key.resource === resource,
        )!
        .observations.map((row) => row.value);
    expect(values('steel')).toEqual([-64, 205, 229]);
    expect(values('tungsten')).toEqual([-95, 1, 1]);
    expect(
      snapshots.map((row) => row.countries[0].economy!.steel.imported),
    ).toEqual([null, null, 24]);
    expect(
      snapshots.map((row) => row.countries[0].economy!.tungsten.extracted),
    ).toEqual([12, 118, 118]);
    expect(
      parseEconomy(economyFixture('C')).commercialTrades.find(
        (row) => row.exporterTag === 'RKB',
      )!.deliveredRaw,
    ).toBe(32);
    expect(data.signals).toEqual([]);
    expect(data.insights).toEqual([]);
  });
});
