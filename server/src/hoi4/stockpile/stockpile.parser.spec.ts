import { parseEquipmentRegistry } from './equipment-registry.parser';
import {
  AMOUNT_FIXTURE,
  DUPLICATE_STOCKPILE_FIXTURE,
  EQUIPMENT_REGISTRY_FIXTURE,
  MALFORMED_STOCKPILE_FIXTURE,
  STOCKPILE_SCOPE_FIXTURE,
} from './fixtures/stockpile.fixture';
import { parseNationalStockpile } from './stockpile.parser';

function parseFixture(saveText: string) {
  const registry = parseEquipmentRegistry(saveText);
  return parseNationalStockpile(saveText, registry);
}

describe('parseNationalStockpile', () => {
  test('preserves positive, negative, integer, fractional and large amounts exactly', () => {
    expect(parseFixture(AMOUNT_FIXTURE).map(({ amount }) => amount)).toEqual([
      49, 15555.42655, -0.4816, -20, 220197.792,
    ]);
  });

  test('captures country ownership and explicit equipment identity', () => {
    expect(parseFixture(STOCKPILE_SCOPE_FIXTURE)[0]).toMatchObject({
      countryTag: 'USA',
      equipmentRef: { id: 2386, type: 70 },
      amount: 49,
      warnings: [],
    });
  });

  test('preserves dynamic tags and reference types other than 70', () => {
    expect(parseFixture(STOCKPILE_SCOPE_FIXTURE)[2]).toMatchObject({
      countryTag: 'D04',
      equipmentRef: { id: 900, type: 170 },
      amount: -0.4816,
    });
  });

  test('attaches resolved metadata and keeps same-definition designs separate', () => {
    const records = parseFixture(STOCKPILE_SCOPE_FIXTURE);

    expect(
      records.slice(0, 2).map(({ equipmentRef, equipment }) => ({
        equipmentRef,
        definition: equipment?.definition,
        name: equipment?.name,
      })),
    ).toEqual([
      {
        equipmentRef: { id: 2386, type: 70 },
        definition: 'light_tank_chassis_1',
        name: 'M2A2',
      },
      {
        equipmentRef: { id: 5199, type: 70 },
        definition: 'light_tank_chassis_1',
        name: 'M2 Light',
      },
    ]);
  });

  test('preserves source order and absolute source offsets', () => {
    const records = parseFixture(STOCKPILE_SCOPE_FIXTURE);

    expect(records.map(({ amount }) => amount)).toEqual([49, 327, -0.4816]);
    expect(records[0].sourceOffset).toBeLessThan(records[1].sourceOffset);
    expect(records[1].sourceOffset).toBeLessThan(records[2].sourceOffset);
  });

  test('ignores every equipment-like hierarchy outside direct production.equipments', () => {
    const records = parseFixture(STOCKPILE_SCOPE_FIXTURE);

    expect(records).toHaveLength(3);
    expect(records.map(({ amount }) => amount)).not.toEqual(
      expect.arrayContaining([999, 888, 777, 666, 100]),
    );
  });

  test('does not emit global registry definitions or countries without the stockpile hierarchy', () => {
    expect(parseFixture(EQUIPMENT_REGISTRY_FIXTURE)).toEqual([]);
    expect(
      parseFixture(STOCKPILE_SCOPE_FIXTURE).some(
        ({ countryTag }) => countryTag === 'LUX',
      ),
    ).toBe(false);
  });

  test('returns an empty array for an empty stockpile', () => {
    const fixture = `HOI4txt
equipments={ known={ id={ id=1 type=70 } } }
countries={ GER={ production={ equipments={ } } } }`;

    expect(parseFixture(fixture)).toEqual([]);
  });

  test('preserves identical duplicate occurrences and warns on the later copy', () => {
    const records = parseFixture(DUPLICATE_STOCKPILE_FIXTURE);

    expect(records).toHaveLength(2);
    expect(records.map(({ amount }) => amount)).toEqual([4, 4]);
    expect(records[1].warnings).toContain(
      'duplicate equipment reference within GER: 70:1',
    );
  });

  test('preserves unresolved references with metadata null and a warning', () => {
    const unresolved = parseFixture(MALFORMED_STOCKPILE_FIXTURE).find(
      ({ equipmentRef }) => equipmentRef?.id === 999,
    );

    expect(unresolved).toMatchObject({
      equipmentRef: { id: 999, type: 70 },
      amount: 8,
      equipment: null,
    });
    expect(unresolved?.warnings).toContain(
      'unresolved equipment reference: 70:999',
    );
  });

  test('returns partial records for missing and malformed amounts', () => {
    const records = parseFixture(MALFORMED_STOCKPILE_FIXTURE);

    expect(records[0].amount).toBeNull();
    expect(records[0].warnings).toContain('missing amount');
    expect(records[1].amount).toBeNull();
    expect(records[1].warnings).toContain('invalid amount: not-a-number');
  });

  test('returns partial records for a missing reference and missing id', () => {
    const records = parseFixture(MALFORMED_STOCKPILE_FIXTURE);

    expect(records[2].equipmentRef).toBeNull();
    expect(records[2].warnings).toContain('missing id');
    expect(records[4].equipmentRef).toBeNull();
    expect(records[4].warnings).toContain('missing id.id');
  });

  test('returns partial records for malformed ids', () => {
    const record = parseFixture(MALFORMED_STOCKPILE_FIXTURE)[3];

    expect(record.equipmentRef).toBeNull();
    expect(record.warnings).toContain('invalid id.id: broken');
  });

  test('returns partial records for missing and malformed types', () => {
    const records = parseFixture(MALFORMED_STOCKPILE_FIXTURE);

    expect(records[5].equipmentRef).toBeNull();
    expect(records[5].warnings).toContain('missing id.type');
    expect(records[6].equipmentRef).toBeNull();
    expect(records[6].warnings).toContain('invalid id.type: broken');
  });

  test('continues parsing valid entries after malformed entries', () => {
    const records = parseFixture(MALFORMED_STOCKPILE_FIXTURE);
    const last = records.at(-1);

    expect(records).toHaveLength(9);
    expect(last).toMatchObject({
      countryTag: 'SOV',
      equipmentRef: { id: 1, type: 70 },
      amount: 9,
      equipment: { definition: 'known_equipment' },
    });
  });

  test('keeps ownership isolated across multiple countries', () => {
    const records = parseFixture(STOCKPILE_SCOPE_FIXTURE);

    expect(records.map(({ countryTag }) => countryTag)).toEqual([
      'USA',
      'USA',
      'D04',
    ]);
  });
});
