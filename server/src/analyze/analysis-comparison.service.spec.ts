import {
  compareAnalysisResults,
  numericDiff,
} from './analysis-comparison.service';
import {
  comparisonCountry as country,
  comparisonResult as result,
} from './fixtures/analysis-comparison.fixture';
import type { NavalLossEvent } from '../hoi4/naval-loss/naval-loss.types';

const compare = (base = result(), target = result()) =>
  compareAnalysisResults('a', 'b', base, target);

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

  test('direction is explicit even when target date is earlier', () => {
    const base = result({
      game_date: '1945.1.1',
      by_country: [country('GER', { ships: 5 })],
    });
    const target = result({ game_date: '1944.1.1' });
    const data = compare(base, target);
    expect(data.baseGameDate).toBe('1945.1.1');
    expect(data.targetGameDate).toBe('1944.1.1');
    expect(data.countries[0].ships.delta).toBe(-3);
    expect(compare(target, base).countries[0].ships.delta).toBe(3);
  });

  test('same result, unknowns and dates do not invent differences', () => {
    const same = result({
      by_country: [country('GER', { calculatedWarCasualtiesTotal: undefined })],
    });
    const data = compareAnalysisResults('a', 'a', same, same);
    expect(data.hasChanges).toBe(false);
    expect(data.countries[0].hasChanges).toBe(false);
    expect(data.summary.divisions.delta).toBe(0);
    expect(data.countries[0].calculatedWarCasualtiesTotal.delta).toBeNull();
    expect(
      compare(result(), result({ game_date: '1946.1.1' })).hasChanges,
    ).toBe(false);
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
