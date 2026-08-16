import { findDirectBlocks } from '../naval-loss/global-history.parser';
import { parseEquipmentRegistry } from '../stockpile/equipment-registry.parser';
import {
  DUPLICATE_MILITARY_PRODUCTION_FIXTURE,
  MALFORMED_MILITARY_PRODUCTION_FIXTURE,
  MILITARY_PRODUCTION_FIXTURE,
} from './fixtures/military-production.fixture';
import { parseMilitaryProductionLines } from './military-production.parser';

function parseFixture(saveText: string) {
  const registry = parseEquipmentRegistry(saveText);
  return parseMilitaryProductionLines(saveText, registry);
}

describe('parseMilitaryProductionLines', () => {
  test('parses direct production.military_lines occurrences', () => {
    expect(parseFixture(MILITARY_PRODUCTION_FIXTURE)).toHaveLength(4);
  });

  test('preserves source order', () => {
    const records = parseFixture(MILITARY_PRODUCTION_FIXTURE);

    expect(records.map(({ lineRef }) => lineRef?.id)).toEqual([1, 2, 3, 4]);
    expect(records.map(({ sourceOffset }) => sourceOffset)).toEqual(
      [...records.map(({ sourceOffset }) => sourceOffset)].sort(
        (left, right) => left - right,
      ),
    );
  });

  test('captures country ownership', () => {
    expect(
      parseFixture(MILITARY_PRODUCTION_FIXTURE).map(
        ({ countryTag }) => countryTag,
      ),
    ).toEqual(['USA', 'USA', 'D04', 'D04']);
  });

  test('keeps the line reference separate from the equipment reference', () => {
    expect(parseFixture(MILITARY_PRODUCTION_FIXTURE)[0]).toMatchObject({
      lineRef: { id: 1, type: 56 },
      equipmentRef: { id: 20, type: 70 },
    });
  });

  test('resolves equipment metadata through the existing registry', () => {
    expect(
      parseFixture(MILITARY_PRODUCTION_FIXTURE)[0].equipment,
    ).toMatchObject({
      equipmentRef: { id: 20, type: 70 },
      definition: 'light_tank_chassis_1',
      name: 'M2A2',
    });
  });

  test('preserves unresolved references and emits a focused warning', () => {
    const record = parseFixture(MILITARY_PRODUCTION_FIXTURE)[3];

    expect(record).toMatchObject({
      equipmentRef: { id: 999, type: 70 },
      equipment: null,
      complete: false,
    });
    expect(record.warnings).toContain('unresolved equipment reference: 70:999');
  });

  test('parses requested, active, queued and damaged factories independently', () => {
    const records = parseFixture(MILITARY_PRODUCTION_FIXTURE);

    expect(records[0]).toMatchObject({
      requestedFactories: 4,
      activeFactories: 4,
      queuedFactories: null,
      damagedFactories: null,
    });
    expect(records[1]).toMatchObject({
      requestedFactories: 3,
      activeFactories: null,
      queuedFactories: 2,
      damagedFactories: 1,
    });
  });

  test('preserves missing optional factory fields as null', () => {
    expect(parseFixture(MILITARY_PRODUCTION_FIXTURE)[2]).toMatchObject({
      activeFactories: null,
      damagedFactories: null,
    });
  });

  test('preserves fractional produced, speed and cost values', () => {
    expect(parseFixture(MILITARY_PRODUCTION_FIXTURE)[0]).toMatchObject({
      produced: 0.125,
      speed: 12.75,
      cost: 2.5,
    });
  });

  test('preserves amount=-1 as a raw numeric value', () => {
    expect(
      parseFixture(MILITARY_PRODUCTION_FIXTURE).map(({ amount }) => amount),
    ).toEqual([-1, -1, -1, -1]);
  });

  test('parses the complete factory efficiency array', () => {
    expect(
      parseFixture(MILITARY_PRODUCTION_FIXTURE)[0].factoryEfficiencies,
    ).toEqual([100, 99.5, 80, 75]);
  });

  test('does not require exactly 150 factory efficiency entries', () => {
    const records = parseFixture(MILITARY_PRODUCTION_FIXTURE);

    expect(records[1].factoryEfficiencies).toEqual([20, 15]);
    expect(records[2].factoryEfficiencies).toEqual([]);
  });

  test('parses open-ended resource names and values', () => {
    expect(parseFixture(MILITARY_PRODUCTION_FIXTURE)[0].resources[0]).toEqual({
      resource: 'steel',
      amount: 8,
      need: 0,
      warnings: [],
    });
    expect(parseFixture(MILITARY_PRODUCTION_FIXTURE)[0].resources[1]).toEqual({
      resource: 'unobtanium',
      amount: 3.25,
      need: 0.75,
      warnings: [],
    });
  });

  test('preserves resource source order', () => {
    expect(
      parseFixture(MILITARY_PRODUCTION_FIXTURE)[0].resources.map(
        ({ resource }) => resource,
      ),
    ).toEqual(['steel', 'unobtanium', null]);
  });

  test('preserves positive resource need without deriving a shortage flag', () => {
    const record = parseFixture(MILITARY_PRODUCTION_FIXTURE)[2];

    expect(record.resources[0].need).toBe(0.25);
    expect(record).not.toHaveProperty('hasResourceShortage');
  });

  test('preserves fractional resource amount and need values', () => {
    expect(parseFixture(MILITARY_PRODUCTION_FIXTURE)[2].resources[0]).toEqual({
      resource: 'modded_crystal',
      amount: 1.5,
      need: 0.25,
      warnings: [],
    });
  });

  test('preserves empty resource entries as deterministic partial records', () => {
    expect(parseFixture(MILITARY_PRODUCTION_FIXTURE)[0].resources[2]).toEqual({
      resource: null,
      amount: null,
      need: null,
      warnings: ['empty resource entry'],
    });
  });

  test('parses the optional industrial manufacturer reference', () => {
    expect(
      parseFixture(MILITARY_PRODUCTION_FIXTURE)[0].industrialManufacturerRef,
    ).toEqual({ id: 9, type: 79 });
  });

  test('allows a missing industrial manufacturer', () => {
    const record = parseFixture(MILITARY_PRODUCTION_FIXTURE)[1];

    expect(record.industrialManufacturerRef).toBeNull();
    expect(record.warnings).toEqual([]);
    expect(record.complete).toBe(true);
  });

  test('resolves unnamed equipment without inventing a name', () => {
    expect(
      parseFixture(MILITARY_PRODUCTION_FIXTURE)[1].equipment,
    ).toMatchObject({
      definition: 'infantry_equipment_1',
      name: null,
    });
  });

  test('preserves obsolete equipment metadata', () => {
    expect(
      parseFixture(MILITARY_PRODUCTION_FIXTURE)[0].equipment?.obsolete,
    ).toBe(true);
  });

  test('supports dynamic country tags and nonstandard equipment types', () => {
    expect(parseFixture(MILITARY_PRODUCTION_FIXTURE)[2]).toMatchObject({
      countryTag: 'D04',
      equipmentRef: { id: 900, type: 170 },
      equipment: { definition: 'modded-airframe.alpha' },
    });
  });

  test('ignores direct naval_lines siblings', () => {
    expect(
      parseFixture(MILITARY_PRODUCTION_FIXTURE).some(
        ({ lineRef }) => lineRef?.id === 500,
      ),
    ).toBe(false);
  });

  test('ignores top-level and nested unrelated military_lines blocks', () => {
    const lineIds = parseFixture(MILITARY_PRODUCTION_FIXTURE).map(
      ({ lineRef }) => lineRef?.id,
    );

    expect(lineIds).not.toContain(999);
    expect(lineIds).not.toContain(998);
  });

  test('preserves duplicate occurrences instead of deduplicating', () => {
    const records = parseFixture(DUPLICATE_MILITARY_PRODUCTION_FIXTURE);

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      lineRef: { id: 5, type: 56 },
      equipmentRef: { id: 10, type: 70 },
    });
    expect(records[1]).toMatchObject({
      lineRef: { id: 5, type: 56 },
      equipmentRef: { id: 10, type: 70 },
    });
  });

  test('returns a partial malformed line and continues with later lines', () => {
    const records = parseFixture(MALFORMED_MILITARY_PRODUCTION_FIXTURE);

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      lineRef: null,
      priority: null,
      amount: null,
      requestedFactories: null,
      cost: null,
      factoryEfficiencies: [10, 20.5],
      complete: false,
    });
    expect(records[0].warnings).toEqual(
      expect.arrayContaining([
        'invalid id.id: broken',
        'invalid priority: broken',
        'invalid amount: not-a-number',
        'missing requested_factories',
        'invalid cost: broken',
        'invalid factory_efficiencies token: broken-token',
        'resources[0]: invalid amount: broken',
        'resources[1]: missing resource',
      ]),
    );
    expect(records[1]).toMatchObject({
      lineRef: { id: 6, type: 56 },
      complete: true,
      warnings: [],
    });
  });

  test('does not mutate input text', () => {
    const original = MILITARY_PRODUCTION_FIXTURE;

    parseFixture(original);

    expect(original).toBe(MILITARY_PRODUCTION_FIXTURE);
  });

  test('does not add aggregation or derived output fields', () => {
    const record = parseFixture(MILITARY_PRODUCTION_FIXTURE)[0];

    expect(record).not.toHaveProperty('itemsPerDay');
    expect(record).not.toHaveProperty('progressPercentage');
    expect(record).not.toHaveProperty('averageEfficiency');
    expect(record).not.toHaveProperty('equipmentCategory');
  });

  test('accepts and reuses an existing top-level block index', () => {
    const topLevelBlocks = findDirectBlocks(
      MILITARY_PRODUCTION_FIXTURE,
      0,
      MILITARY_PRODUCTION_FIXTURE.length,
    );
    const registry = parseEquipmentRegistry(
      MILITARY_PRODUCTION_FIXTURE,
      topLevelBlocks,
    );

    expect(
      parseMilitaryProductionLines(
        MILITARY_PRODUCTION_FIXTURE,
        registry,
        topLevelBlocks,
      ),
    ).toHaveLength(4);
  });
});
