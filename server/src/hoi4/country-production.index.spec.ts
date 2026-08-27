import { findDirectBlocks } from './naval-loss/global-history.parser';
import {
  buildCountryBlockByTag,
  buildCountryProductionIndex,
} from './country-production.index';

describe('buildCountryProductionIndex', () => {
  const fixture = `
    countries={
      GER={
        production={ marker=first }
        fleet={ marker=direct_fleet }
        units={
          fleet={ marker=nested_fleet }
          theatres={ marker=nested_theatres }
        }
        theatres={ marker=direct_theatres }
      }
      invalid={ production={ marker=ignored } }
      D04={
        production={ marker=second }
        production={ marker=third }
        units={ marker=direct_units }
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
    expect(index.map(({ fleetBlocks }) => fleetBlocks.length)).toEqual([1, 0]);
    expect(index.map(({ unitsBlocks }) => unitsBlocks.length)).toEqual([1, 1]);
    expect(index.map(({ theatresBlocks }) => theatresBlocks.length)).toEqual([
      1, 0,
    ]);
    expect(index[0].countryBlock.key).toBe('GER');
    expect(index[0].countryBlock.keyOffset).toBeLessThan(
      index[1].countryBlock.keyOffset,
    );
    expect(index[1].productionBlocks[0].keyOffset).toBeLessThan(
      index[1].productionBlocks[1].keyOffset,
    );
    expect(
      fixture.slice(
        index[0].fleetBlocks[0].bodyStart,
        index[0].fleetBlocks[0].bodyEnd,
      ),
    ).toContain('marker=direct_fleet');
    expect(index[0].fleetBlocks).toHaveLength(1);
    expect(
      fixture.slice(
        index[0].theatresBlocks[0].bodyStart,
        index[0].theatresBlocks[0].bodyEnd,
      ),
    ).toContain('marker=direct_theatres');
    expect(index[0].theatresBlocks).toHaveLength(1);
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

  test.each(['fleet', 'units', 'theatres'])(
    'preserves incomplete direct %s blocks',
    (key) => {
      const malformed = `countries={ GER={ ${key}={ marker=yes`;
      const [entry] = buildCountryProductionIndex(malformed);
      const blocks =
        key === 'fleet'
          ? entry.fleetBlocks
          : key === 'units'
            ? entry.unitsBlocks
            : entry.theatresBlocks;

      expect(entry.countryBlock.complete).toBe(false);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].complete).toBe(false);
    },
  );

  test('derives direct country lookup from existing indexed blocks', () => {
    const index = buildCountryProductionIndex(fixture);
    const countryBlockByTag = buildCountryBlockByTag(index);
    const germany = countryBlockByTag.get('GER');

    expect([...countryBlockByTag.keys()]).toEqual(['GER', 'D04']);
    expect(germany).toBe(index[0].countryBlock);
    expect(
      germany && fixture.slice(germany.bodyStart, germany.bodyEnd),
    ).toContain('marker=first');
    expect(countryBlockByTag.get('invalid')).toBeUndefined();
  });

  test('keeps the first source occurrence for duplicate country tags', () => {
    const duplicateFixture = `countries={
      AAA={ marker=first }
      AAA={ marker=second }
    }`;
    const index = buildCountryProductionIndex(duplicateFixture);
    const countryBlock = buildCountryBlockByTag(index).get('AAA');

    expect(index).toHaveLength(2);
    expect(countryBlock).toBe(index[0].countryBlock);
    expect(
      countryBlock &&
        duplicateFixture.slice(countryBlock.bodyStart, countryBlock.bodyEnd),
    ).toContain('marker=first');
  });
});
