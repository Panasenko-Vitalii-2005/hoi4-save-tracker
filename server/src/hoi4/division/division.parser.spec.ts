import { findDirectBlocks } from '../naval-loss/global-history.parser';
import { parseEquipmentRegistry } from '../stockpile/equipment-registry.parser';
import {
  DIVISION_FIXTURE,
  DIVISION_SCOPE_FIXTURE,
  MALFORMED_DIVISION_FIXTURE,
} from './fixtures/division.fixture';
import { parseDivisions } from './division.parser';

function parseFixture(saveText: string) {
  const registry = parseEquipmentRegistry(saveText);
  return parseDivisions(saveText, registry);
}

describe('parseDivisions', () => {
  test('parses only direct countries.TAG.units.division records', () => {
    const records = parseFixture(DIVISION_SCOPE_FIXTURE);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      countryTag: 'GER',
      divisionRef: { id: 1, type: 51 },
      name: { overrideName: 'Canonical' },
    });
  });

  test('preserves canonical source order and absolute source offsets', () => {
    const records = parseFixture(DIVISION_FIXTURE);

    expect(records.map(({ divisionRef }) => divisionRef?.id)).toEqual([
      1, 2, 3,
    ]);
    expect(records.map(({ sourceOffset }) => sourceOffset)).toEqual(
      [...records.map(({ sourceOffset }) => sourceOffset)].sort(
        (left, right) => left - right,
      ),
    );
  });

  test('captures controlling countries and supports dynamic tags', () => {
    expect(
      parseFixture(DIVISION_FIXTURE).map(({ countryTag }) => countryTag),
    ).toEqual(['USA', 'USA', 'D04']);
  });

  test('preserves type 51 division references', () => {
    expect(parseFixture(DIVISION_FIXTURE)[0].divisionRef).toEqual({
      id: 1,
      type: 51,
    });
  });

  test('preserves type 4713 division references', () => {
    expect(parseFixture(DIVISION_FIXTURE)[1].divisionRef).toEqual({
      id: 2,
      type: 4713,
    });
  });

  test('accepts identical duplicate division ID blocks without warning', () => {
    const record = parseFixture(DIVISION_FIXTURE)[0];

    expect(record.divisionRef).toEqual({ id: 1, type: 51 });
    expect(record.warnings).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('conflicting division id blocks'),
      ]),
    );
  });

  test('preserves literal override names without fabricating generated names', () => {
    expect(parseFixture(DIVISION_FIXTURE)[0].name).toEqual({
      overrideName: 'Hawaiian Division',
      type: 0,
      order: null,
    });
  });

  test('preserves generated-name descriptors when override is absent', () => {
    expect(parseFixture(DIVISION_FIXTURE)[1].name).toEqual({
      overrideName: null,
      type: 0,
      order: 42,
    });
  });

  test('preserves the exact division template reference without resolving it', () => {
    const record = parseFixture(DIVISION_FIXTURE)[0];

    expect(record.divisionTemplateRef).toEqual({ id: 100, type: 52 });
    expect(record).not.toHaveProperty('divisionTemplate');
  });

  test('parses current and required manpower independently', () => {
    expect(parseFixture(DIVISION_FIXTURE)[0].manpower).toEqual({
      current: 12520,
      required: 12520,
      currentTag: 'USA',
      requiredTag: 'USA',
    });
  });

  test('preserves foreign manpower tags without replacing them with the controller', () => {
    expect(parseFixture(DIVISION_FIXTURE)[1]).toMatchObject({
      countryTag: 'USA',
      manpower: {
        currentTag: 'FRA',
        requiredTag: 'FRA',
      },
    });
  });

  test('preserves logical country and expeditionary owner separately', () => {
    expect(parseFixture(DIVISION_FIXTURE)[2]).toMatchObject({
      countryTag: 'D04',
      logicalCountryTag: 'D04',
      expeditionaryOwnerTag: 'RKN',
      manpower: {
        currentTag: 'RKN',
        requiredTag: 'RKN',
      },
    });
  });

  test('preserves raw strength above 100 without normalization', () => {
    const record = parseFixture(DIVISION_FIXTURE)[0];

    expect(record.strength).toBe(232.8);
    expect(record).not.toHaveProperty('strengthPercentage');
    expect(record).not.toHaveProperty('maxStrength');
  });

  test('preserves raw organization without percentage conversion', () => {
    const record = parseFixture(DIVISION_FIXTURE)[0];

    expect(record.organization).toBe(33.25);
    expect(record).not.toHaveProperty('organizationPercentage');
    expect(record).not.toHaveProperty('maxOrganization');
  });

  test('preserves raw experience without deriving a level', () => {
    const record = parseFixture(DIVISION_FIXTURE)[0];

    expect(record.experience).toBe(1636.33096);
    expect(record).not.toHaveProperty('experienceLevel');
  });

  test('preserves multiple equipment variants in source order', () => {
    const equipment = parseFixture(DIVISION_FIXTURE)[0].equipment;

    expect(equipment.map(({ equipmentRef }) => equipmentRef)).toEqual([
      { id: 10, type: 70 },
      { id: 20, type: 170 },
    ]);
    expect(equipment.map(({ amount }) => amount)).toEqual([1010, 1.25]);
  });

  test('resolves exact equipment metadata through the supplied registry', () => {
    const equipment = parseFixture(DIVISION_FIXTURE)[0].equipment;

    expect(equipment[0].equipment).toMatchObject({
      equipmentRef: { id: 10, type: 70 },
      definition: 'infantry_equipment_2',
      name: 'Service Rifle',
    });
    expect(equipment[1].equipment).toMatchObject({
      equipmentRef: { id: 20, type: 170 },
      definition: 'modded_tank.alpha',
      name: 'Variant Alpha',
    });
  });

  test('preserves unresolved equipment references with focused warnings', () => {
    const record = parseFixture(DIVISION_FIXTURE)[2];
    const unresolved = record.equipment[2];

    expect(unresolved).toMatchObject({
      equipmentRef: { id: 999, type: 70 },
      amount: 0.03846,
      equipment: null,
    });
    expect(unresolved.warnings).toContain(
      'unresolved equipment reference: 70:999',
    );
    expect(record.warnings).toContain(
      'equipment[2]: unresolved equipment reference: 70:999',
    );
  });

  test('preserves zero, negative and fractional equipment amounts', () => {
    expect(
      parseFixture(DIVISION_FIXTURE)[2].equipment.map(({ amount }) => amount),
    ).toEqual([0, -2.5, 0.03846]);
  });

  test('preserves the numeric province ID without map resolution', () => {
    const record = parseFixture(DIVISION_FIXTURE)[0];

    expect(record.provinceId).toBe(4200);
    expect(record).not.toHaveProperty('provinceName');
    expect(record).not.toHaveProperty('stateId');
  });

  test('preserves all direct supply fields without calculating a percentage', () => {
    const record = parseFixture(DIVISION_FIXTURE)[0];

    expect(record.supply).toEqual({
      current: 120,
      max: 108,
      gain: 0.15,
      outOfSupplyDays: 3,
      disrupted: 0.25,
    });
    expect(record).not.toHaveProperty('supplyPercentage');
  });

  test('does not clamp current supply when it exceeds stored max supply', () => {
    expect(parseFixture(DIVISION_FIXTURE)[0].supply).toMatchObject({
      current: 120,
      max: 108,
    });
  });

  test('preserves fuel and fuel_requested independently', () => {
    expect(parseFixture(DIVISION_FIXTURE)[0]).toMatchObject({
      fuel: 6.5,
      fuelRequested: 1.25,
    });
  });

  test('preserves missing fuel as null rather than zero', () => {
    expect(parseFixture(DIVISION_FIXTURE)[1]).toMatchObject({
      fuel: null,
      fuelRequested: null,
    });
  });

  test('preserves direct status flags without deriving activity state', () => {
    const record = parseFixture(DIVISION_FIXTURE)[0];

    expect(record.status).toEqual({
      strategicRedeployment: true,
      retreat: false,
      supportAttack: 6519,
    });
    expect(record).not.toHaveProperty('moving');
    expect(record).not.toHaveProperty('currentlyFighting');
    expect(record).not.toHaveProperty('idle');
  });

  test('recovers the only valid duplicate ID block and warns', () => {
    const record = parseFixture(MALFORMED_DIVISION_FIXTURE)[0];

    expect(record.divisionRef).toEqual({ id: 7, type: 4713 });
    expect(record.warnings).toEqual(
      expect.arrayContaining([
        'invalid division id[0].id: broken',
        'only one valid division id block',
      ]),
    );
  });

  test('uses the first valid ID deterministically when duplicate IDs conflict', () => {
    const record = parseFixture(MALFORMED_DIVISION_FIXTURE)[1];

    expect(record.divisionRef).toEqual({ id: 8, type: 51 });
    expect(record.warnings).toContain(
      'conflicting division id blocks: 51:8 vs 4713:9',
    );
  });

  test('warns instead of failing when the division ID is missing', () => {
    const fixture = MALFORMED_DIVISION_FIXTURE.replace(
      'id={ id=broken type=broken }',
      '',
    );
    const record = parseFixture(fixture)[2];

    expect(record.divisionRef).toBeNull();
    expect(record.warnings).toContain('missing division id');
  });

  test('returns null fields with warnings for malformed manpower and scalars', () => {
    const record = parseFixture(MALFORMED_DIVISION_FIXTURE)[2];

    expect(record).toMatchObject({
      divisionRef: null,
      divisionTemplateRef: null,
      name: { overrideName: null, type: null, order: null },
      manpower: {
        current: null,
        required: null,
        currentTag: null,
        requiredTag: null,
      },
      strength: null,
      organization: null,
      experience: null,
      provinceId: null,
      fuel: null,
      complete: false,
    });
    expect(record.warnings).toEqual(
      expect.arrayContaining([
        'invalid army_manpower_value.value.value: invalid',
        'missing army_manpower_need',
        'invalid strength: invalid',
        'invalid organisation: invalid',
        'invalid experience: invalid',
        'invalid location: invalid',
        'invalid retreat: perhaps',
      ]),
    );
  });

  test('keeps malformed equipment as a partial child record', () => {
    const record = parseFixture(MALFORMED_DIVISION_FIXTURE)[2];

    expect(record.equipment[0]).toMatchObject({
      equipmentRef: null,
      amount: null,
      equipment: null,
    });
    expect(record.equipment[0].warnings).toEqual(
      expect.arrayContaining(['missing id.type', 'invalid amount: invalid']),
    );
  });

  test('continues parsing valid divisions after malformed records', () => {
    const records = parseFixture(MALFORMED_DIVISION_FIXTURE);

    expect(records).toHaveLength(4);
    expect(records.at(-1)).toMatchObject({
      divisionRef: { id: 10, type: 51 },
      name: { overrideName: 'Valid Later Division' },
      complete: true,
      warnings: [],
    });
  });

  test('warns on logical country mismatch without changing the controller', () => {
    const record = parseFixture(MALFORMED_DIVISION_FIXTURE)[1];

    expect(record.countryTag).toBe('GER');
    expect(record.logicalCountryTag).toBe('SOV');
    expect(record.warnings).toContain(
      'logical_country mismatch: expected GER, got SOV',
    );
  });

  test('does not expose equipment requirements, deficits or completeness', () => {
    const record = parseFixture(DIVISION_FIXTURE)[0];

    expect(record).not.toHaveProperty('requiredEquipment');
    expect(record).not.toHaveProperty('missingEquipment');
    expect(record).not.toHaveProperty('equipmentCompleteness');
    expect(record).not.toHaveProperty('isReinforcing');
    expect(record.equipment[0]).not.toHaveProperty('requiredAmount');
  });

  test('accepts and reuses an existing top-level block index', () => {
    const topLevelBlocks = findDirectBlocks(
      DIVISION_FIXTURE,
      0,
      DIVISION_FIXTURE.length,
    );
    const registry = parseEquipmentRegistry(DIVISION_FIXTURE, topLevelBlocks);

    expect(
      parseDivisions(DIVISION_FIXTURE, registry, topLevelBlocks),
    ).toHaveLength(3);
  });

  test('does not mutate the save text, registry or supplied block index', () => {
    const originalText = DIVISION_FIXTURE;
    const topLevelBlocks = findDirectBlocks(
      originalText,
      0,
      originalText.length,
    );
    const registry = parseEquipmentRegistry(originalText, topLevelBlocks);
    const blocksBefore = JSON.stringify(topLevelBlocks);
    const registryBefore = JSON.stringify(registry);

    parseDivisions(originalText, registry, topLevelBlocks);

    expect(originalText).toBe(DIVISION_FIXTURE);
    expect(JSON.stringify(topLevelBlocks)).toBe(blocksBefore);
    expect(JSON.stringify(registry)).toBe(registryBefore);
  });

  test('returns deterministic records for identical inputs', () => {
    const registry = parseEquipmentRegistry(DIVISION_FIXTURE);

    expect(parseDivisions(DIVISION_FIXTURE, registry)).toEqual(
      parseDivisions(DIVISION_FIXTURE, registry),
    );
  });
});
