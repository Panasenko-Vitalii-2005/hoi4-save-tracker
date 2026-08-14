import { parseEquipmentRegistry } from './equipment-registry.parser';
import { EQUIPMENT_REGISTRY_FIXTURE } from './fixtures/stockpile.fixture';

describe('parseEquipmentRegistry', () => {
  const registry = parseEquipmentRegistry(EQUIPMENT_REGISTRY_FIXTURE);

  test('parses only direct definitions from the top-level registry in source order', () => {
    expect(registry.records.map(({ definition }) => definition)).toEqual([
      'infantry_equipment_1',
      'light_tank_chassis_1',
      'light_tank_chassis_1',
      'modded-equipment.alpha',
    ]);
    expect(registry.records).toHaveLength(4);
  });

  test('captures a normal definition and its explicit reference', () => {
    expect(registry.records[0]).toMatchObject({
      definition: 'infantry_equipment_1',
      equipmentRef: { id: 10, type: 70 },
      name: null,
      maxVersion: 0,
      creatorTag: 'ENG',
      originTag: '---',
      obsolete: false,
      isFrame: false,
      warnings: [],
    });
  });

  test('captures optional variant metadata without parsing modules', () => {
    expect(registry.records[1]).toMatchObject({
      equipmentRef: { id: 2386, type: 70 },
      name: 'M2A2',
      version: 2,
      maxVersion: null,
      parentEquipmentRef: { id: 2385, type: 70 },
      creatorTag: 'USA',
      originTag: 'CZE',
      obsolete: true,
      isFrame: false,
      designTeamRef: { id: 42, type: 79 },
      warnings: [],
    });
  });

  test('keeps two designs sharing a definition separate by reference', () => {
    const designs = registry.records.filter(
      ({ definition }) => definition === 'light_tank_chassis_1',
    );

    expect(
      designs.map(({ equipmentRef, name, version }) => ({
        equipmentRef,
        name,
        version,
      })),
    ).toEqual([
      { equipmentRef: { id: 2386, type: 70 }, name: 'M2A2', version: 2 },
      { equipmentRef: { id: 5199, type: 70 }, name: 'M2 Light', version: 3 },
    ]);
  });

  test('preserves arbitrary definitions, dynamic creators, empty names and non-70 types', () => {
    expect(registry.records[3]).toMatchObject({
      definition: 'modded-equipment.alpha',
      equipmentRef: { id: 900, type: 170 },
      name: '',
      creatorTag: 'D04',
    });
  });

  test('records absolute source offsets and reports no duplicate references', () => {
    expect(registry.records[0].sourceOffset).toBe(
      EQUIPMENT_REGISTRY_FIXTURE.indexOf('infantry_equipment_1='),
    );
    expect(registry.records[0].sourceOffset).toBeLessThan(
      registry.records[1].sourceOffset,
    );
    expect(registry.duplicateReferences).toEqual([]);
    expect(registry.warnings).toEqual([]);
  });

  test('ignores unrelated nested equipments blocks', () => {
    expect(
      registry.records.some(
        ({ definition }) => definition === 'nested_equipment',
      ),
    ).toBe(false);
  });
});
