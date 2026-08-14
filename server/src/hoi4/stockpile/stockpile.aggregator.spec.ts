import {
  createEquipmentFixture,
  createStockpileFixture,
} from './fixtures/aggregation.fixture';
import { aggregateNationalStockpile } from './stockpile.aggregator';

describe('aggregateNationalStockpile', () => {
  test('summarizes one country with one exact variant', () => {
    const equipment = createEquipmentFixture({
      id: 1,
      definition: 'infantry_equipment_1',
      name: 'Rifle',
      version: 2,
      creatorTag: 'GER',
      originTag: 'CZE',
      obsolete: true,
    });

    expect(
      aggregateNationalStockpile([
        createStockpileFixture({ countryTag: 'GER', equipment, amount: 12 }),
      ]),
    ).toEqual([
      {
        countryTag: 'GER',
        definitions: [
          {
            definition: 'infantry_equipment_1',
            amount: 12,
            variants: [
              {
                equipmentRef: { id: 1, type: 70 },
                definition: 'infantry_equipment_1',
                variantName: 'Rifle',
                amount: 12,
                version: 2,
                creatorTag: 'GER',
                originTag: 'CZE',
                obsolete: true,
              },
            ],
          },
        ],
        unresolvedVariants: [],
      },
    ]);
  });

  test('keeps multiple definitions and variants while calculating definition totals', () => {
    const m2a2 = createEquipmentFixture({
      id: 2386,
      definition: 'light_tank_chassis_1',
      name: 'M2A2',
    });
    const m2Light = createEquipmentFixture({
      id: 5199,
      definition: 'light_tank_chassis_1',
      name: 'M2 Light',
    });
    const rifle = createEquipmentFixture({
      id: 10,
      definition: 'infantry_equipment_1',
    });
    const summaries = aggregateNationalStockpile([
      createStockpileFixture({
        countryTag: 'USA',
        equipment: m2a2,
        amount: 49,
      }),
      createStockpileFixture({
        countryTag: 'USA',
        equipment: m2Light,
        amount: 327,
      }),
      createStockpileFixture({
        countryTag: 'USA',
        equipment: rifle,
        amount: 5,
      }),
    ]);

    expect(
      summaries[0].definitions.map(({ definition }) => definition),
    ).toEqual(['infantry_equipment_1', 'light_tank_chassis_1']);
    expect(summaries[0].definitions[1]).toMatchObject({
      amount: 376,
      variants: [
        { equipmentRef: { id: 5199, type: 70 }, amount: 327 },
        { equipmentRef: { id: 2386, type: 70 }, amount: 49 },
      ],
    });
  });

  test('sums duplicate references with signed and fractional arithmetic', () => {
    const equipment = createEquipmentFixture({
      id: 1,
      definition: 'test_equipment',
    });
    const summaries = aggregateNationalStockpile(
      [100, -0.5, 20].map((amount) =>
        createStockpileFixture({ countryTag: 'GER', equipment, amount }),
      ),
    );

    expect(summaries[0].definitions[0].variants[0].amount).toBeCloseTo(119.5);
    expect(summaries[0].definitions[0].amount).toBeCloseTo(119.5);
  });

  test('preserves negative variant and definition totals', () => {
    const equipment = createEquipmentFixture({
      id: 1,
      definition: 'test_equipment',
    });
    const summary = aggregateNationalStockpile([
      createStockpileFixture({ countryTag: 'SOV', equipment, amount: -0.7408 }),
    ])[0];

    expect(summary.definitions[0].variants[0].amount).toBe(-0.7408);
    expect(summary.definitions[0].amount).toBe(-0.7408);
  });

  test('preserves a variant and definition whose duplicates cancel to zero', () => {
    const equipment = createEquipmentFixture({
      id: 1,
      definition: 'test_equipment',
    });
    const summary = aggregateNationalStockpile(
      [4, -4].map((amount) =>
        createStockpileFixture({ countryTag: 'GER', equipment, amount }),
      ),
    )[0];

    expect(summary.definitions).toHaveLength(1);
    expect(summary.definitions[0].variants).toHaveLength(1);
    expect(summary.definitions[0].variants[0].amount).toBe(0);
    expect(summary.definitions[0].amount).toBe(0);
  });

  test('keeps missing names null and arbitrary definitions and dynamic tags verbatim', () => {
    const equipment = createEquipmentFixture({
      id: 9,
      type: 170,
      definition: 'modded-equipment.alpha',
      creatorTag: 'D04',
    });
    const summary = aggregateNationalStockpile([
      createStockpileFixture({ countryTag: 'D04', equipment, amount: 1.5 }),
    ])[0];

    expect(summary.countryTag).toBe('D04');
    expect(summary.definitions[0].definition).toBe('modded-equipment.alpha');
    expect(summary.definitions[0].variants[0]).toMatchObject({
      variantName: null,
      creatorTag: 'D04',
    });
  });

  test('isolates countries and sorts them by tag', () => {
    const equipment = createEquipmentFixture({
      id: 1,
      definition: 'test_equipment',
    });
    const summaries = aggregateNationalStockpile([
      createStockpileFixture({ countryTag: 'USA', equipment, amount: 2 }),
      createStockpileFixture({ countryTag: 'D04', equipment, amount: 1 }),
      createStockpileFixture({ countryTag: 'GER', equipment, amount: 3 }),
    ]);

    expect(summaries.map(({ countryTag }) => countryTag)).toEqual([
      'D04',
      'GER',
      'USA',
    ]);
    expect(summaries.map(({ definitions }) => definitions[0].amount)).toEqual([
      1, 3, 2,
    ]);
  });

  test('preserves and separately aggregates unresolved equipment references', () => {
    const summaries = aggregateNationalStockpile([
      createStockpileFixture({
        countryTag: 'GER',
        equipmentRef: { id: 90, type: 70 },
        amount: 2,
      }),
      createStockpileFixture({
        countryTag: 'GER',
        equipmentRef: { id: 90, type: 70 },
        amount: -0.5,
      }),
      createStockpileFixture({
        countryTag: 'GER',
        equipmentRef: { id: 91, type: 70 },
        amount: 4,
      }),
    ]);

    expect(summaries[0].unresolvedVariants).toEqual([
      { equipmentRef: { id: 91, type: 70 }, amount: 4 },
      { equipmentRef: { id: 90, type: 70 }, amount: 1.5 },
    ]);
  });

  test('uses available metadata for all copies sharing one reference', () => {
    const equipment = createEquipmentFixture({
      id: 90,
      definition: 'resolved_equipment',
    });
    const summary = aggregateNationalStockpile([
      createStockpileFixture({
        countryTag: 'GER',
        equipmentRef: { id: 90, type: 70 },
        amount: 2,
      }),
      createStockpileFixture({ countryTag: 'GER', equipment, amount: 3 }),
    ])[0];

    expect(summary.unresolvedVariants).toEqual([]);
    expect(summary.definitions[0]).toMatchObject({
      definition: 'resolved_equipment',
      amount: 5,
      variants: [{ equipmentRef: { id: 90, type: 70 }, amount: 5 }],
    });
  });

  test('keeps numeric records without an equipment reference separate', () => {
    const summary = aggregateNationalStockpile([
      createStockpileFixture({ countryTag: 'GER', amount: 2 }),
      createStockpileFixture({ countryTag: 'GER', amount: 2 }),
    ])[0];

    expect(summary.unresolvedVariants).toEqual([
      { equipmentRef: null, amount: 2 },
      { equipmentRef: null, amount: 2 },
    ]);
  });

  test('excludes null amounts instead of treating them as zero', () => {
    const equipment = createEquipmentFixture({
      id: 1,
      definition: 'test_equipment',
    });

    expect(
      aggregateNationalStockpile([
        createStockpileFixture({ countryTag: 'GER', equipment, amount: null }),
      ]),
    ).toEqual([]);
  });

  test('does not mutate raw records', () => {
    const equipment = createEquipmentFixture({
      id: 1,
      definition: 'test_equipment',
    });
    const records = [
      createStockpileFixture({ countryTag: 'GER', equipment, amount: 2 }),
    ];
    const before = structuredClone(records);

    aggregateNationalStockpile(records);

    expect(records).toEqual(before);
  });

  test('produces the same aggregate values regardless of input order', () => {
    const equipment = createEquipmentFixture({
      id: 1,
      definition: 'test_equipment',
    });
    const records = [0.1, 0.2, -0.05].map((amount) =>
      createStockpileFixture({ countryTag: 'GER', equipment, amount }),
    );

    expect(aggregateNationalStockpile(records)).toEqual(
      aggregateNationalStockpile([...records].reverse()),
    );
  });

  test('sorts definitions and variants deterministically', () => {
    const variants = [
      createEquipmentFixture({
        id: 5,
        definition: 'z_definition',
        name: 'Alpha',
      }),
      createEquipmentFixture({
        id: 9,
        type: 69,
        definition: 'z_definition',
        name: 'Alpha',
      }),
      createEquipmentFixture({
        id: 4,
        definition: 'z_definition',
        name: 'Beta',
      }),
      createEquipmentFixture({ id: 1, definition: 'z_definition' }),
      createEquipmentFixture({
        id: 2,
        definition: 'z_definition',
        name: 'High',
      }),
      createEquipmentFixture({
        id: 3,
        definition: 'a_definition',
        name: 'First',
      }),
    ];
    const amounts = [10, 10, 10, 10, 20, 1];
    const summary = aggregateNationalStockpile(
      variants.map((equipment, index) =>
        createStockpileFixture({
          countryTag: 'GER',
          equipment,
          amount: amounts[index],
        }),
      ),
    )[0];

    expect(summary.definitions.map(({ definition }) => definition)).toEqual([
      'a_definition',
      'z_definition',
    ]);
    expect(
      summary.definitions[1].variants.map(({ equipmentRef }) => equipmentRef),
    ).toEqual([
      { id: 2, type: 70 },
      { id: 9, type: 69 },
      { id: 5, type: 70 },
      { id: 4, type: 70 },
      { id: 1, type: 70 },
    ]);
  });

  test('keeps equal display names with different references separate', () => {
    const summaries = aggregateNationalStockpile(
      [1, 2].map((id) => {
        const equipment = createEquipmentFixture({
          id,
          definition: 'test_equipment',
          name: 'Same name',
        });
        return createStockpileFixture({
          countryTag: 'GER',
          equipment,
          amount: id,
        });
      }),
    );

    expect(summaries[0].definitions[0].variants).toHaveLength(2);
  });

  test('keeps variants with different creator and origin metadata separate', () => {
    const first = createEquipmentFixture({
      id: 1,
      definition: 'test_equipment',
      creatorTag: 'GER',
      originTag: 'CZE',
    });
    const second = createEquipmentFixture({
      id: 2,
      definition: 'test_equipment',
      creatorTag: 'USA',
      originTag: 'ENG',
    });
    const variants = aggregateNationalStockpile([
      createStockpileFixture({
        countryTag: 'GER',
        equipment: first,
        amount: 1,
      }),
      createStockpileFixture({
        countryTag: 'GER',
        equipment: second,
        amount: 1,
      }),
    ])[0].definitions[0].variants;

    expect(variants).toHaveLength(2);
    expect(
      variants.map(({ creatorTag, originTag }) => ({ creatorTag, originTag })),
    ).toEqual([
      { creatorTag: 'GER', originTag: 'CZE' },
      { creatorTag: 'USA', originTag: 'ENG' },
    ]);
  });

  test('preserves very large decimals and ignores parser warnings', () => {
    const equipment = createEquipmentFixture({
      id: 1,
      definition: 'test_equipment',
    });
    const summary = aggregateNationalStockpile([
      createStockpileFixture({
        countryTag: 'GER',
        equipment,
        amount: 220197.792,
        warnings: ['diagnostic warning'],
      }),
    ])[0];

    expect(summary.definitions[0].amount).toBe(220197.792);
  });

  test('chooses canonical metadata deterministically for conflicting duplicates', () => {
    const later = createEquipmentFixture({
      id: 1,
      definition: 'z_definition',
      name: 'Later',
      sourceOffset: 20,
    });
    const earlier = createEquipmentFixture({
      id: 1,
      definition: 'a_definition',
      name: 'Earlier',
      sourceOffset: 10,
    });
    const records = [
      createStockpileFixture({
        countryTag: 'GER',
        equipment: later,
        amount: 1,
      }),
      createStockpileFixture({
        countryTag: 'GER',
        equipment: earlier,
        amount: 2,
      }),
    ];

    expect(aggregateNationalStockpile(records)).toEqual(
      aggregateNationalStockpile([...records].reverse()),
    );
    expect(
      aggregateNationalStockpile(records)[0].definitions[0].variants[0],
    ).toMatchObject({
      definition: 'a_definition',
      variantName: 'Earlier',
      amount: 3,
    });
  });

  test('returns an empty array and exposes no categories or country-wide ranking total', () => {
    expect(aggregateNationalStockpile([])).toEqual([]);

    const equipment = createEquipmentFixture({
      id: 1,
      definition: 'test_equipment',
    });
    const summary = aggregateNationalStockpile([
      createStockpileFixture({ countryTag: 'GER', equipment, amount: 1 }),
    ])[0];

    expect(summary).not.toHaveProperty('amount');
    expect(summary).not.toHaveProperty('total');
    expect(summary).not.toHaveProperty('categories');
    expect(summary.definitions[0]).not.toHaveProperty('category');
  });
});
