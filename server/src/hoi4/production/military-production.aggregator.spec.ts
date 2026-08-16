import {
  productionEquipment,
  productionLine,
} from './fixtures/military-production-aggregation.fixture';
import { aggregateMilitaryProduction } from './military-production.aggregator';

describe('aggregateMilitaryProduction', () => {
  test('aggregates production by country', () => {
    const summaries = aggregateMilitaryProduction([
      productionLine({ countryTag: 'GER' }),
      productionLine({ countryTag: 'USA', sourceOffset: 200 }),
    ]);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({ countryTag: 'GER', lineCount: 1 });
    expect(summaries[1]).toMatchObject({ countryTag: 'USA', lineCount: 1 });
  });

  test('groups resolved lines by exact equipment definition', () => {
    const [summary] = aggregateMilitaryProduction([
      productionLine(),
      productionLine({
        lineRef: { id: 2, type: 56 },
        equipmentRef: { id: 200, type: 70 },
        equipment: productionEquipment({
          equipmentRef: { id: 200, type: 70 },
          definition: 'fighter_equipment_1',
        }),
        sourceOffset: 200,
      }),
    ]);

    expect(summary.definitionCount).toBe(2);
    expect(
      summary.definitions.map(({ equipmentDefinition }) => equipmentDefinition),
    ).toEqual(['fighter_equipment_1', 'infantry_equipment_1']);
  });

  test('preserves multiple variants under one definition', () => {
    const [summary] = aggregateMilitaryProduction([
      productionLine(),
      productionLine({
        lineRef: { id: 2, type: 56 },
        equipmentRef: { id: 101, type: 70 },
        equipment: productionEquipment({
          equipmentRef: { id: 101, type: 70 },
          name: 'Rifle B',
        }),
        sourceOffset: 200,
      }),
    ]);

    expect(summary.definitions).toHaveLength(1);
    expect(summary.definitions[0]).toMatchObject({ lineCount: 2 });
    expect(summary.definitions[0].lines).toHaveLength(2);
  });

  test('preserves multiple lines for the same exact variant', () => {
    const [definition] = aggregateMilitaryProduction([
      productionLine(),
      productionLine({ lineRef: { id: 2, type: 56 }, sourceOffset: 200 }),
    ])[0].definitions;

    expect(definition.lineCount).toBe(2);
    expect(definition.lines.map(({ equipmentRef }) => equipmentRef)).toEqual([
      { id: 100, type: 70 },
      { id: 100, type: 70 },
    ]);
  });

  test('preserves unnamed variants', () => {
    const line = aggregateMilitaryProduction([
      productionLine({ equipment: productionEquipment({ name: null }) }),
    ])[0].definitions[0].lines[0];

    expect(line.variantName).toBeNull();
  });

  test('preserves obsolete metadata', () => {
    const line = aggregateMilitaryProduction([
      productionLine({ equipment: productionEquipment({ obsolete: true }) }),
    ])[0].definitions[0].lines[0];

    expect(line.obsolete).toBe(true);
  });

  test('sums requested factories', () => {
    const [summary] = aggregateMilitaryProduction([
      productionLine({ requestedFactories: 2 }),
      productionLine({
        lineRef: { id: 2, type: 56 },
        requestedFactories: 3,
        sourceOffset: 200,
      }),
    ]);

    expect(summary.requestedFactories).toBe(5);
    expect(summary.definitions[0].requestedFactories).toBe(5);
  });

  test('sums active factories', () => {
    const [summary] = aggregateMilitaryProduction([
      productionLine({ activeFactories: 2 }),
      productionLine({
        lineRef: { id: 2, type: 56 },
        activeFactories: 3,
        sourceOffset: 200,
      }),
    ]);

    expect(summary.activeFactories).toBe(5);
    expect(summary.definitions[0].activeFactories).toBe(5);
  });

  test('sums queued factories', () => {
    const [summary] = aggregateMilitaryProduction([
      productionLine({ queuedFactories: 2 }),
      productionLine({
        lineRef: { id: 2, type: 56 },
        queuedFactories: 1,
        sourceOffset: 200,
      }),
    ]);

    expect(summary.queuedFactories).toBe(3);
    expect(summary.definitions[0].queuedFactories).toBe(3);
  });

  test('sums damaged factories', () => {
    const [summary] = aggregateMilitaryProduction([
      productionLine({ damagedFactories: 1 }),
      productionLine({
        lineRef: { id: 2, type: 56 },
        damagedFactories: 2,
        sourceOffset: 200,
      }),
    ]);

    expect(summary.damagedFactories).toBe(3);
    expect(summary.definitions[0].damagedFactories).toBe(3);
  });

  test('uses effective zero only in the aggregate layer', () => {
    const raw = productionLine({
      requestedFactories: null,
      activeFactories: null,
      queuedFactories: null,
      damagedFactories: null,
    });
    const [summary] = aggregateMilitaryProduction([raw]);
    const line = summary.definitions[0].lines[0];

    expect(raw.activeFactories).toBeNull();
    expect(line).toMatchObject({
      requestedFactories: null,
      activeFactories: null,
      effectiveActiveFactories: 0,
      effectiveQueuedFactories: 0,
      effectiveDamagedFactories: 0,
    });
    expect(summary).toMatchObject({
      requestedFactories: 0,
      activeFactories: 0,
      queuedFactories: 0,
      damagedFactories: 0,
    });
  });

  test('derives current items per day from speed and cost', () => {
    const line = aggregateMilitaryProduction([
      productionLine({ speed: 9, cost: 4 }),
    ])[0].definitions[0].lines[0];

    expect(line.currentItemsPerDay).toBe(2.25);
  });

  test('keeps current items per day null when speed is missing', () => {
    const definition = aggregateMilitaryProduction([
      productionLine({ speed: null }),
    ])[0].definitions[0];

    expect(definition.lines[0].currentItemsPerDay).toBeNull();
    expect(definition).toMatchObject({
      currentItemsPerDay: null,
      knownCurrentItemsPerDay: 0,
      outputComplete: false,
    });
  });

  test.each([0, -2, Number.NaN, Number.POSITIVE_INFINITY])(
    'keeps output null for invalid or non-positive cost %p',
    (cost) => {
      const line = aggregateMilitaryProduction([productionLine({ cost })])[0]
        .definitions[0].lines[0];

      expect(line.currentItemsPerDay).toBeNull();
      expect(line.progressFraction).toBeNull();
    },
  );

  test('derives progress as an unclamped fraction', () => {
    const line = aggregateMilitaryProduction([
      productionLine({ produced: 3, cost: 4 }),
    ])[0].definitions[0].lines[0];

    expect(line.progressFraction).toBe(0.75);
  });

  test('keeps progress null when produced is missing', () => {
    const line = aggregateMilitaryProduction([
      productionLine({ produced: null }),
    ])[0].definitions[0].lines[0];

    expect(line.progressFraction).toBeNull();
  });

  test('derives active efficiency average', () => {
    const line = aggregateMilitaryProduction([
      productionLine({ activeFactories: 2, factoryEfficiencies: [90, 70] }),
    ])[0].definitions[0].lines[0];

    expect(line.activeEfficiencyAverage).toBe(80);
  });

  test('derives active efficiency minimum and maximum', () => {
    const line = aggregateMilitaryProduction([
      productionLine({
        activeFactories: 3,
        factoryEfficiencies: [90, 65, 110],
      }),
    ])[0].definitions[0].lines[0];

    expect(line.activeEfficiencyMin).toBe(65);
    expect(line.activeEfficiencyMax).toBe(110);
  });

  test('uses only the first active-factory efficiency slots', () => {
    const line = aggregateMilitaryProduction([
      productionLine({
        activeFactories: 2,
        factoryEfficiencies: [100, 80, 1],
      }),
    ])[0].definitions[0].lines[0];

    expect(line.activeEfficiencyAverage).toBe(90);
    expect(line.activeEfficiencyMin).toBe(80);
  });

  test('uses available values and warns for a short efficiency array', () => {
    const line = aggregateMilitaryProduction([
      productionLine({
        activeFactories: 3,
        factoryEfficiencies: [90, 70],
      }),
    ])[0].definitions[0].lines[0];

    expect(line.activeEfficiencyAverage).toBe(80);
    expect(line.complete).toBe(false);
    expect(line.warnings).toContain(
      'incomplete active efficiency coverage: expected 3, found 2',
    );
  });

  test.each([null, 0])(
    'uses null efficiency metrics for active factory count %p',
    (activeFactories) => {
      const line = aggregateMilitaryProduction([
        productionLine({ activeFactories }),
      ])[0].definitions[0].lines[0];

      expect(line.activeEfficiencyAverage).toBeNull();
      expect(line.activeEfficiencyMin).toBeNull();
      expect(line.activeEfficiencyMax).toBeNull();
    },
  );

  test('detects a positive resource shortage', () => {
    const line = aggregateMilitaryProduction([
      productionLine({
        resources: [{ resource: 'steel', amount: 2, need: 1, warnings: [] }],
      }),
    ])[0].definitions[0].lines[0];

    expect(line.hasResourceShortage).toBe(true);
    expect(line.resourceShortages).toEqual([
      { resource: 'steel', amount: 2, need: 1 },
    ]);
  });

  test('preserves multiple shortages in source order', () => {
    const line = aggregateMilitaryProduction([
      productionLine({
        resources: [
          { resource: 'rubber', amount: 1.5, need: 0.5, warnings: [] },
          { resource: 'steel', amount: 0, need: 3, warnings: [] },
        ],
      }),
    ])[0].definitions[0].lines[0];

    expect(line.resourceShortages).toEqual([
      { resource: 'rubber', amount: 1.5, need: 0.5 },
      { resource: 'steel', amount: 0, need: 3 },
    ]);
  });

  test('does not treat need=0 as a shortage', () => {
    const line = aggregateMilitaryProduction([productionLine()])[0]
      .definitions[0].lines[0];

    expect(line.hasResourceShortage).toBe(false);
    expect(line.resourceShortages).toEqual([]);
  });

  test('counts shortage lines per definition', () => {
    const shortage = {
      resource: 'steel',
      amount: 1,
      need: 1,
      warnings: [] as string[],
    };
    const definition = aggregateMilitaryProduction([
      productionLine({ resources: [shortage] }),
      productionLine({ lineRef: { id: 2, type: 56 }, sourceOffset: 200 }),
    ])[0].definitions[0];

    expect(definition.resourceShortageLineCount).toBe(1);
  });

  test('counts shortage lines per country including unresolved lines', () => {
    const [summary] = aggregateMilitaryProduction([
      productionLine(),
      productionLine({
        lineRef: { id: 2, type: 56 },
        equipment: null,
        equipmentRef: { id: 999, type: 70 },
        resources: [{ resource: 'steel', amount: 0, need: 2, warnings: [] }],
        sourceOffset: 200,
      }),
    ]);

    expect(summary.resourceShortageLineCount).toBe(1);
  });

  test('preserves unresolved equipment in a separate country collection', () => {
    const [summary] = aggregateMilitaryProduction([
      productionLine({
        equipment: null,
        equipmentRef: { id: 999, type: 70 },
        warnings: ['unresolved equipment reference: 70:999'],
        complete: false,
      }),
    ]);

    expect(summary.definitions).toEqual([]);
    expect(summary.unresolvedLines).toHaveLength(1);
    expect(summary.unresolvedLines[0]).toMatchObject({
      equipmentRef: { id: 999, type: 70 },
      currentItemsPerDay: 2,
    });
  });

  test('does not merge duplicate variant names', () => {
    const lines = aggregateMilitaryProduction([
      productionLine(),
      productionLine({
        lineRef: { id: 2, type: 56 },
        equipmentRef: { id: 101, type: 70 },
        equipment: productionEquipment({
          equipmentRef: { id: 101, type: 70 },
          name: 'Rifle A',
        }),
        sourceOffset: 200,
      }),
    ])[0].definitions[0].lines;

    expect(lines).toHaveLength(2);
    expect(lines.map(({ equipmentRef }) => equipmentRef?.id)).toEqual([
      100, 101,
    ]);
  });

  test('sorts countries by tag ascending', () => {
    expect(
      aggregateMilitaryProduction([
        productionLine({ countryTag: 'USA' }),
        productionLine({ countryTag: 'D04', sourceOffset: 200 }),
        productionLine({ countryTag: 'GER', sourceOffset: 300 }),
      ]).map(({ countryTag }) => countryTag),
    ).toEqual(['D04', 'GER', 'USA']);
  });

  test('sorts definitions ascending', () => {
    const [summary] = aggregateMilitaryProduction([
      productionLine({
        equipment: productionEquipment({ definition: 'z_equipment' }),
      }),
      productionLine({
        lineRef: { id: 2, type: 56 },
        equipment: productionEquipment({ definition: 'a_equipment' }),
        sourceOffset: 200,
      }),
    ]);

    expect(
      summary.definitions.map(({ equipmentDefinition }) => equipmentDefinition),
    ).toEqual(['a_equipment', 'z_equipment']);
  });

  test('sorts lines by factories, name and line reference', () => {
    const createSortedLine = (
      id: number,
      activeFactories: number,
      requestedFactories: number,
      name: string | null,
      sourceOffset: number,
    ) =>
      productionLine({
        lineRef: { id, type: 56 },
        activeFactories,
        requestedFactories,
        equipmentRef: { id: id + 100, type: 70 },
        equipment: productionEquipment({
          equipmentRef: { id: id + 100, type: 70 },
          name,
        }),
        sourceOffset,
      });
    const lines = aggregateMilitaryProduction([
      createSortedLine(5, 1, 5, null, 500),
      createSortedLine(4, 1, 5, 'Alpha', 400),
      createSortedLine(3, 1, 6, 'Zulu', 300),
      createSortedLine(2, 2, 2, 'Bravo', 200),
      createSortedLine(1, 2, 2, 'Alpha', 100),
    ])[0].definitions[0].lines;

    expect(lines.map(({ lineRef }) => lineRef?.id)).toEqual([1, 2, 3, 4, 5]);
  });

  test('does not mutate raw input records', () => {
    const records = [productionLine()];
    const before = JSON.parse(JSON.stringify(records)) as unknown;

    aggregateMilitaryProduction(records);

    expect(records).toEqual(before);
  });

  test('preserves fractional values in summaries and totals', () => {
    const [summary] = aggregateMilitaryProduction([
      productionLine({
        requestedFactories: 1.5,
        activeFactories: 1.5,
        speed: 1.25,
        cost: 0.5,
      }),
    ]);

    expect(summary.requestedFactories).toBe(1.5);
    expect(summary.activeFactories).toBe(1.5);
    expect(summary.definitions[0].lines[0].currentItemsPerDay).toBe(2.5);
  });

  test('does not clamp unusual progress values', () => {
    const lines = aggregateMilitaryProduction([
      productionLine({ produced: 10, cost: 4 }),
      productionLine({
        lineRef: { id: 2, type: 56 },
        produced: -2,
        cost: 4,
        sourceOffset: 200,
      }),
    ])[0].definitions[0].lines;

    expect(lines.map(({ progressFraction }) => progressFraction)).toEqual([
      2.5, -0.5,
    ]);
  });

  test('does not silently replace incomplete definition output with zero', () => {
    const definition = aggregateMilitaryProduction([
      productionLine({ speed: 8, cost: 4 }),
      productionLine({
        lineRef: { id: 2, type: 56 },
        speed: null,
        sourceOffset: 200,
      }),
    ])[0].definitions[0];

    expect(definition).toMatchObject({
      currentItemsPerDay: null,
      knownCurrentItemsPerDay: 2,
      outputComplete: false,
    });
  });

  test('does not invent broad categories, scores or country output totals', () => {
    const summary = aggregateMilitaryProduction([productionLine()])[0];
    const line = summary.definitions[0].lines[0];

    expect(summary).not.toHaveProperty('countryTotalItemsPerDay');
    expect(summary).not.toHaveProperty('productionScore');
    expect(line).not.toHaveProperty('equipmentCategory');
    expect(line).not.toHaveProperty('itemsPerMonth');
  });

  test('is deterministic regardless of input order', () => {
    const records = [
      productionLine({ countryTag: 'USA', sourceOffset: 300 }),
      productionLine({
        countryTag: 'GER',
        lineRef: { id: 2, type: 56 },
        sourceOffset: 200,
      }),
      productionLine({ countryTag: 'GER', sourceOffset: 100 }),
    ];

    expect(aggregateMilitaryProduction(records)).toEqual(
      aggregateMilitaryProduction([...records].reverse()),
    );
  });

  test('returns an empty list for empty input', () => {
    expect(aggregateMilitaryProduction([])).toEqual([]);
  });
});
