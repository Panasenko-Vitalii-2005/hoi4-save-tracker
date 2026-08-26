import { findDirectBlocks } from './naval-loss/global-history.parser';
import { buildCountryProductionIndex } from './country-production.index';

describe('buildCountryProductionIndex', () => {
  const fixture = `
    countries={
      GER={ production={ marker=first } }
      invalid={ production={ marker=ignored } }
      D04={
        production={ marker=second }
        production={ marker=third }
        nested={ production={ marker=nested } }
      }
    }
    unrelated={ GER={ production={ marker=outside } } }
  `;

  test('indexes valid country tags and direct production blocks in source order', () => {
    const index = buildCountryProductionIndex(fixture);

    expect(index.map(({ countryTag }) => countryTag)).toEqual(['GER', 'D04']);
    expect(
      index.map(({ productionBlocks }) => productionBlocks.length),
    ).toEqual([1, 2]);
    expect(index[0].countryBlock.key).toBe('GER');
    expect(index[0].countryBlock.keyOffset).toBeLessThan(
      index[1].countryBlock.keyOffset,
    );
    expect(index[1].productionBlocks[0].keyOffset).toBeLessThan(
      index[1].productionBlocks[1].keyOffset,
    );
  });

  test('reuses a supplied top-level block index', () => {
    const topLevelBlocks = findDirectBlocks(fixture, 0, fixture.length);

    expect(buildCountryProductionIndex(fixture, topLevelBlocks)).toEqual(
      buildCountryProductionIndex(fixture),
    );
  });

  test('preserves incomplete direct production blocks', () => {
    const malformed = 'countries={ GER={ production={ marker=yes';
    const [entry] = buildCountryProductionIndex(malformed);

    expect(entry.countryTag).toBe('GER');
    expect(entry.countryBlock.complete).toBe(false);
    expect(entry.productionBlocks).toHaveLength(1);
    expect(entry.productionBlocks[0].complete).toBe(false);
  });
});
