import {
  compareAnalysisResults,
  numericDiff,
} from './analysis-comparison.service';
import {
  comparisonCountry as country,
  comparisonResult as result,
} from './fixtures/analysis-comparison.fixture';
import type { NavalLossEvent } from '../hoi4/naval-loss/naval-loss.types';
import type { SaveComparisonContext } from '../hoi4/save-comparison-context';
import type {
  MilitaryProductionDefinitionSummary,
  MilitaryProductionLineSummary,
} from '../hoi4/production/production.types';

const compare = (base = result(), target = result()) =>
  compareAnalysisResults('a', 'b', base, target);
const context = (
  campaignId: string | null,
  gameVersion = '1.19.2',
): SaveComparisonContext => ({ campaignId, gameVersion });

const stockpile = (
  countryTag: string,
  definitions: Array<[string, number]>,
) => ({
  countryTag,
  definitions: definitions.map(([definition, amount]) => ({
    definition,
    amount,
    variants: [],
  })),
  unresolvedVariants: [],
});

const productionDefinition = (
  equipmentDefinition: string,
  activeFactories: number,
  currentItemsPerDay: number | null,
  outputComplete = currentItemsPerDay !== null,
  knownCurrentItemsPerDay = currentItemsPerDay ?? 0,
  identity?: { lineId: number; equipmentId: number },
): MilitaryProductionDefinitionSummary => ({
  equipmentDefinition,
  lineCount: 1,
  requestedFactories: activeFactories,
  activeFactories,
  queuedFactories: 0,
  damagedFactories: 0,
  currentItemsPerDay,
  knownCurrentItemsPerDay,
  outputComplete,
  resourceShortageLineCount: 0,
  lines: identity
    ? [
        {
          countryTag: 'GER',
          lineRef: { type: 56, id: identity.lineId },
          equipmentRef: { type: 70, id: identity.equipmentId },
          equipmentDefinition,
          variantName: null,
          version: null,
          creatorTag: null,
          originTag: null,
          obsolete: null,
          priority: null,
          requestedFactories: activeFactories,
          activeFactories,
          queuedFactories: 0,
          damagedFactories: 0,
          effectiveActiveFactories: activeFactories,
          effectiveQueuedFactories: 0,
          effectiveDamagedFactories: 0,
          currentItemsPerDay,
          progressFraction: null,
          activeEfficiencyAverage: null,
          activeEfficiencyMin: null,
          activeEfficiencyMax: null,
          hasResourceShortage: false,
          resourceShortages: [],
          industrialManufacturerRef: null,
          complete: true,
          warnings: [],
        } satisfies MilitaryProductionLineSummary,
      ]
    : [],
});

const production = (
  countryTag: string,
  definitions: MilitaryProductionDefinitionSummary[],
) => ({
  countryTag,
  lineCount: definitions.length,
  definitionCount: definitions.length,
  requestedFactories: definitions.reduce(
    (total, definition) => total + definition.requestedFactories,
    0,
  ),
  activeFactories: definitions.reduce(
    (total, definition) => total + definition.activeFactories,
    0,
  ),
  queuedFactories: 0,
  damagedFactories: 0,
  resourceShortageLineCount: 0,
  definitions,
  unresolvedLines: [],
});

describe('Analysis comparison', () => {
  test.each([
    [2, 5, 3],
    [5, 2, -3],
    [0, 0, 0],
    [-2.5, 1.25, 3.75],
    [null, 5, null],
    [5, undefined, null],
    [undefined, null, null],
    [NaN, 1, null],
    [Infinity, 1, null],
    ['2', 4, null],
  ])('numeric diff %p → %p = %p', (before, after, delta) => {
    expect(numericDiff(before, after).delta).toBe(delta);
  });

  test('invalid numbers and overflow never leak as non-finite JSON values', () => {
    expect(numericDiff(Infinity, NaN)).toEqual({
      before: null,
      after: null,
      delta: null,
    });
    expect(numericDiff(-Number.MAX_VALUE, Number.MAX_VALUE).delta).toBeNull();
  });

  test('compares final industry, not physical buildings or ownership components', () => {
    const row = compare(
      result(),
      result({
        by_country: [
          country('GER', {
            effectiveMilitaryFactories: 9,
            effectiveCivilianFactories: 2,
            effectiveDockyards: 0,
          }),
        ],
      }),
    ).countries[0];
    expect(row.effectiveMilitaryFactories).toEqual({
      before: 4,
      after: 9,
      delta: 5,
    });
    expect(row.effectiveCivilianFactories.delta).toBe(-3);
    expect(row.effectiveDockyards.delta).toBe(-3);
  });

  test('preserves count, manpower and calculated bilateral casualty semantics', () => {
    const row = compare(
      result(),
      result({
        by_country: [
          country('GER', {
            divisions: 12,
            ships: 1,
            manpowerInField: 850,
            calculatedWarCasualtiesTotal: 30,
          }),
        ],
      }),
    ).countries[0];
    expect(row.status).toBe('unchanged');
    expect(row.hasChanges).toBe(true);
    expect(row.divisions.delta).toBe(2);
    expect(row.ships.delta).toBe(-1);
    expect(row.manpowerInField.delta).toBe(-150);
    expect(row.calculatedWarCasualtiesTotal.delta).toBe(10);
    expect(row).not.toHaveProperty('manpowerCasualties');
  });

  test('unavailable optional casualties are not fabricated from raw records or zero', () => {
    const data = compare(
      result({
        by_country: [
          country('GER', { calculatedWarCasualtiesTotal: undefined }),
        ],
      }),
    );
    expect(data.countries[0].calculatedWarCasualtiesTotal).toEqual({
      before: null,
      after: 20,
      delta: null,
    });
    expect(data.countries[0].hasChanges).toBe(true);
  });

  test('aggregates signed fractional stockpile balances by exact definition', () => {
    const data = compare(
      result({
        stockpileSummaries: [
          stockpile('GER', [
            ['infantry_equipment_2', -2.5],
            ['infantry_equipment_2', 1.25],
          ]),
        ],
      }),
      result({
        stockpileSummaries: [
          stockpile('GER', [
            ['infantry_equipment_2', 3.5],
            ['infantry_equipment_2', 0.25],
          ]),
        ],
      }),
    );
    const definition = data.equipmentProduction[0].definitions[0];
    expect(definition.stockpile).toEqual({
      presence: 'both',
      balance: { before: -1.25, after: 3.75, delta: 5 },
    });
    expect(definition.hasChanges).toBe(true);
  });

  test('preserves Base-only and Target-only exact definitions without implicit zero', () => {
    const data = compare(
      result({
        stockpileSummaries: [stockpile('GER', [['modded_alpha', 4]])],
      }),
      result({
        stockpileSummaries: [stockpile('GER', [['modded_beta', -1.5]])],
      }),
    );
    expect(data.equipmentProduction[0].definitions).toEqual([
      expect.objectContaining({
        equipmentDefinition: 'modded_alpha',
        stockpile: {
          presence: 'base_only',
          balance: { before: 4, after: null, delta: null },
        },
      }),
      expect.objectContaining({
        equipmentDefinition: 'modded_beta',
        stockpile: {
          presence: 'target_only',
          balance: { before: null, after: -1.5, delta: null },
        },
      }),
    ]);
  });

  test('aggregates factories and complete rates by definition rather than line or design identity', () => {
    const data = compare(
      result({
        militaryProductionSummaries: [
          production('GER', [
            productionDefinition('medium_tank_chassis_2', 2, 1.25, true, 1.25, {
              lineId: 1,
              equipmentId: 10,
            }),
            productionDefinition('medium_tank_chassis_2', 3, 2.5, true, 2.5, {
              lineId: 2,
              equipmentId: 11,
            }),
          ]),
        ],
      }),
      result({
        militaryProductionSummaries: [
          production('GER', [
            productionDefinition('medium_tank_chassis_2', 4, 3, true, 3, {
              lineId: 101,
              equipmentId: 110,
            }),
            productionDefinition('medium_tank_chassis_2', 5, 4.75, true, 4.75, {
              lineId: 102,
              equipmentId: 111,
            }),
          ]),
        ],
      }),
    );
    const productionChange =
      data.equipmentProduction[0].definitions[0].production;
    expect(productionChange).toEqual({
      presence: 'both',
      activeFactories: { before: 5, after: 9, delta: 4 },
      currentItemsPerDay: {
        before: 3.75,
        after: 7.75,
        delta: 4,
        baseComplete: true,
        targetComplete: true,
        baseKnown: 3.75,
        targetKnown: 7.75,
      },
    });
  });

  test('incomplete production output remains known but has no fabricated rate delta', () => {
    const data = compare(
      result({
        militaryProductionSummaries: [
          production('GER', [
            productionDefinition('small_plane_airframe_2', 2, null, false, 1.5),
          ]),
        ],
      }),
      result({
        militaryProductionSummaries: [
          production('GER', [
            productionDefinition('small_plane_airframe_2', 4, 3.25),
          ]),
        ],
      }),
    );
    expect(
      data.equipmentProduction[0].definitions[0].production?.currentItemsPerDay,
    ).toEqual({
      before: null,
      after: 3.25,
      delta: null,
      baseComplete: false,
      targetComplete: true,
      baseKnown: 1.5,
      targetKnown: 3.25,
    });
  });

  test('equipment changes participate in existing changed-country filtering semantics', () => {
    const data = compare(
      result({
        stockpileSummaries: [stockpile('GER', [['support_equipment_1', 1]])],
      }),
      result({
        stockpileSummaries: [stockpile('GER', [['support_equipment_1', 2]])],
      }),
    );
    expect(data.countries[0].hasChanges).toBe(true);
    expect(data.hasChanges).toBe(true);
    expect(data.context).toEqual({
      chronology: 'same_date',
      sameAnalysis: false,
      campaignCompatibility: 'unknown',
      gameVersionCompatibility: 'unknown',
    });
  });

  test('country union preserves added/removed tags with unknown absent-side values', () => {
    const data = compare(
      result({ by_country: [country('SOV'), country('GER')] }),
      result({ by_country: [country('GER'), country('D04')] }),
    );
    expect(data.countries.map(({ tag, status }) => [tag, status])).toEqual([
      ['D04', 'added'],
      ['GER', 'unchanged'],
      ['SOV', 'removed'],
    ]);
    expect(data.countries[0].divisions).toEqual({
      before: null,
      after: 10,
      delta: null,
    });
    expect(data.countries[2].ships).toEqual({
      before: 2,
      after: null,
      delta: null,
    });
    expect(data.countries.map((c) => c.hasChanges)).toEqual([
      true,
      false,
      true,
    ]);
  });

  test('identities never merge by presentation names (aliases DEN/DNK stay separate)', () => {
    const data = compare(
      result({ by_country: [country('DNK'), country('DEN')] }),
      result({ by_country: [country('DEN')] }),
    );
    expect(data.countries.map((c) => [c.tag, c.status])).toEqual([
      ['DEN', 'unchanged'],
      ['DNK', 'removed'],
    ]);
  });

  test('global summary uses existing totals, not re-counted country/division arrays', () => {
    const target = result({
      active_countries: 4,
      navalLosses: [{} as NavalLossEvent],
    });
    target.totals.divisions = 50;
    target.totals.ships = 20;
    target.totals.aircraft = 30;
    target.totals.manpowerInField = 1200;
    const { summary } = compare(result(), target);
    expect(
      Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, v.delta])),
    ).toEqual({
      activeCountries: 3,
      divisions: 40,
      ships: 18,
      aircraft: 25,
      manpowerInField: 200,
      navalLossCount: 1,
    });
  });

  test('chronology is numeric and direction remains Target minus Base', () => {
    const base = result({
      game_date: '1944.10.1',
      by_country: [country('GER', { ships: 5 })],
    });
    const target = result({ game_date: '1944.9.1' });
    const data = compare(base, target);
    expect(data.baseGameDate).toBe('1944.10.1');
    expect(data.targetGameDate).toBe('1944.9.1');
    expect(data.context.chronology).toBe('target_before_base');
    expect(data.countries[0].ships.delta).toBe(-3);
    const swapped = compare(target, base);
    expect(swapped.context.chronology).toBe('target_after_base');
    expect(swapped.countries[0].ships.delta).toBe(3);
  });

  test.each([
    ['1944.5.1', '1944.5.1', 'same_date'],
    ['1944.5.1', '1944.5.2', 'target_after_base'],
    ['1944.5.2', '1944.5.1', 'target_before_base'],
    ['1944.5.1.2', '1944.5.2', 'unknown'],
    ['unknown', '1944.5.2', 'unknown'],
    ['1944.13.1', '1944.5.2', 'unknown'],
  ])(
    'classifies chronology %s → %s as %s',
    (baseDate, targetDate, expected) => {
      expect(
        compare(
          result({ game_date: baseDate }),
          result({ game_date: targetDate }),
        ).context.chronology,
      ).toBe(expected);
    },
  );

  test('campaign and game-version compatibility require persisted evidence', () => {
    const campaignA = '0731c3c7-035e-46b1-b07b-6c35b27e8dc2';
    const campaignB = '016a6f0b-47b4-4812-a626-73537dcc5c56';
    const same = compareAnalysisResults(
      'a',
      'b',
      result(),
      result(),
      context(campaignA),
      context(campaignA),
    );
    expect(same.context.campaignCompatibility).toBe('same');
    expect(same.context.gameVersionCompatibility).toBe('same');

    const different = compareAnalysisResults(
      'a',
      'b',
      result(),
      result(),
      context(campaignA, '1.19.2'),
      context(campaignB, '1.20.0'),
    );
    expect(different.context.campaignCompatibility).toBe('different');
    expect(different.context.gameVersionCompatibility).toBe('different');

    expect(compare().context).toMatchObject({
      campaignCompatibility: 'unknown',
      gameVersionCompatibility: 'unknown',
    });
  });

  test('same result, unknowns and dates do not invent differences', () => {
    const same = result({
      by_country: [country('GER', { calculatedWarCasualtiesTotal: undefined })],
    });
    const data = compareAnalysisResults('a', 'a', same, same);
    expect(data.context.sameAnalysis).toBe(true);
    expect(data.context.chronology).toBe('same_date');
    expect(data.hasChanges).toBe(false);
    expect(data.countries[0].hasChanges).toBe(false);
    expect(data.summary.divisions.delta).toBe(0);
    expect(data.countries[0].calculatedWarCasualtiesTotal.delta).toBeNull();
    expect(
      compare(result(), result({ game_date: '1946.1.1' })).hasChanges,
    ).toBe(false);
  });

  test('empty snapshots expose a non-optional empty equipment projection', () => {
    expect(compare().equipmentProduction).toEqual([]);
  });

  test('tag ordering is deterministic without mutating either input', () => {
    const base = result({ by_country: [country('USA'), country('GER')] });
    const target = result({ by_country: [country('SOV'), country('USA')] });
    const snapshot = JSON.stringify([base, target]);
    expect(compare(base, target)).toEqual(
      compare(
        { ...base, by_country: [...base.by_country].reverse() },
        { ...target, by_country: [...target.by_country].reverse() },
      ),
    );
    expect(JSON.stringify([base, target])).toBe(snapshot);
  });
});
