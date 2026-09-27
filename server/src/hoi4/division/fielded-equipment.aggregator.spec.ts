import { aggregateDivisions } from './division.aggregator';
import { aggregateFieldedEquipment } from './fielded-equipment.aggregator';
import {
  divisionEquipment,
  divisionEquipmentDefinition,
  divisionRecord,
  divisionTemplate,
} from './fixtures/division-aggregation.fixture';

describe('fielded equipment aggregation', () => {
  const american = divisionEquipmentDefinition({
    equipmentRef: { type: 70, id: 1 },
    definition: 'anti_air_equipment_2',
    name: null,
    creatorTag: 'USA',
  });
  const japanese = divisionEquipmentDefinition({
    equipmentRef: { type: 70, id: 2 },
    definition: 'anti_air_equipment_2',
    name: 'Type 2 20 mm',
    creatorTag: 'JAP',
    originTag: 'JAP',
  });

  function summary() {
    const divisions = [
      divisionRecord({
        countryTag: 'USA',
        divisionRef: { type: 51, id: 1 },
        equipment: [
          divisionEquipment({
            equipmentRef: american.equipmentRef,
            equipment: american,
            amount: 1.25,
          }),
          divisionEquipment({
            equipmentRef: japanese.equipmentRef,
            equipment: japanese,
            amount: 2,
          }),
        ],
      }),
      divisionRecord({
        countryTag: 'USA',
        divisionRef: { type: 51, id: 2 },
        expeditionaryOwnerTag: 'ENG',
        equipment: [
          divisionEquipment({
            equipmentRef: american.equipmentRef,
            equipment: american,
            amount: 3.5,
          }),
          divisionEquipment({
            equipmentRef: { type: 70, id: 999 },
            equipment: null,
            amount: 4,
          }),
          divisionEquipment({
            equipmentRef: null,
            equipment: null,
            amount: null,
          }),
        ],
      }),
      divisionRecord({
        countryTag: 'GER',
        divisionRef: { type: 51, id: 3 },
        equipment: [
          divisionEquipment({
            equipmentRef: american.equipmentRef,
            equipment: american,
            amount: 10,
          }),
        ],
      }),
    ];
    return aggregateDivisions(divisions, [divisionTemplate()]);
  }

  it('groups exact variant refs and preserves fractional amounts, metadata and controller scope', () => {
    const resolved = summary();
    const before = JSON.stringify(resolved);
    const fielded = aggregateFieldedEquipment(resolved);
    expect(fielded.map(({ countryTag }) => countryTag)).toEqual(['GER', 'USA']);
    const usa = fielded[1];
    expect(usa.definitions).toHaveLength(1);
    expect(usa.definitions[0]).toMatchObject({
      definition: 'anti_air_equipment_2',
      amount: 6.75,
    });
    expect(usa.definitions[0].variants).toEqual([
      {
        equipmentRef: { type: 70, id: 1 },
        definition: 'anti_air_equipment_2',
        variantName: null,
        amount: 4.75,
        version: 2,
        creatorTag: 'USA',
        originTag: 'GER',
        obsolete: false,
      },
      {
        equipmentRef: { type: 70, id: 2 },
        definition: 'anti_air_equipment_2',
        variantName: 'Type 2 20 mm',
        amount: 2,
        version: 2,
        creatorTag: 'JAP',
        originTag: 'JAP',
        obsolete: false,
      },
    ]);
    expect(
      usa.definitions[0].variants.reduce(
        (sum, variant) => sum + variant.amount,
        0,
      ),
    ).toBe(usa.definitions[0].amount);
    expect(fielded[0].definitions[0].amount).toBe(10);
    expect(usa.unresolvedOccurrences).toEqual([
      { equipmentRef: { type: 70, id: 999 }, amount: 4 },
      { equipmentRef: null, amount: null },
    ]);
    expect(JSON.stringify(resolved)).toBe(before);
  });

  it('does not invent requirements or shortages and handles countries with no equipment', () => {
    const country = aggregateDivisions(
      [divisionRecord({ countryTag: 'USA', equipment: [] })],
      [divisionTemplate()],
    );
    const [fielded] = aggregateFieldedEquipment(country);
    expect(fielded).toEqual({
      countryTag: 'USA',
      definitions: [],
      unresolvedOccurrences: [],
    });
    expect(fielded).not.toHaveProperty('required');
    expect(fielded).not.toHaveProperty('missing');
  });
});
