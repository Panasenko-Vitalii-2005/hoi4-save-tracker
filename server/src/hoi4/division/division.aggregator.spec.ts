import { aggregateDivisions } from './division.aggregator';
import {
  DIVISION_AGGREGATION_RECORDS,
  DIVISION_AGGREGATION_TEMPLATES,
  divisionEquipment,
  divisionEquipmentDefinition,
  divisionRecord,
  divisionTemplate,
} from './fixtures/division-aggregation.fixture';

describe('aggregateDivisions', () => {
  test('resolves one division against its exact template reference', () => {
    const division = aggregateDivisions(
      [divisionRecord()],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division.template?.templateRef).toEqual({ id: 100, type: 52 });
  });

  test('keeps multiple countries isolated', () => {
    const countries = aggregateDivisions(
      DIVISION_AGGREGATION_RECORDS,
      DIVISION_AGGREGATION_TEMPLATES,
    );

    expect(countries).toHaveLength(2);
    expect(
      countries[0].divisions.every(({ countryTag }) => countryTag === 'GER'),
    ).toBe(true);
    expect(
      countries[1].divisions.every(({ countryTag }) => countryTag === 'USA'),
    ).toBe(true);
  });

  test('groups divisions by their exact controller countryTag', () => {
    const countries = aggregateDivisions(
      [
        divisionRecord({ divisionRef: { id: 1, type: 51 } }),
        divisionRecord({ divisionRef: { id: 2, type: 51 } }),
      ],
      [divisionTemplate()],
    );

    expect(countries).toHaveLength(1);
    expect(countries[0]).toMatchObject({ countryTag: 'GER', divisionCount: 2 });
  });

  test('preserves the exact resolved template name', () => {
    const division = aggregateDivisions(
      [divisionRecord()],
      [divisionTemplate({ name: 'Exact Template Name' })],
    )[0].divisions[0];

    expect(division.template?.name).toBe('Exact Template Name');
  });

  test('preserves the raw open-ended template role', () => {
    const division = aggregateDivisions(
      [divisionRecord()],
      [divisionTemplate({ role: 'rangers_role' })],
    )[0].divisions[0];

    expect(division.template?.role).toBe('rangers_role');
  });

  test('preserves all three exact template composition collections', () => {
    const template = aggregateDivisions(
      [divisionRecord()],
      [divisionTemplate()],
    )[0].divisions[0].template;

    expect(template?.regiments.map(({ unitType }) => unitType)).toEqual([
      'infantry',
      'infantry',
    ]);
    expect(template?.supportCompanies[0].unitType).toBe('engineer');
    expect(template?.regimentalSupport[0].unitType).toBe('fire_support');
  });

  test('preserves obsolete templates instead of filtering them', () => {
    const template = aggregateDivisions(
      [divisionRecord()],
      [
        divisionTemplate({
          obsolete: true,
          obsoleteDate: '1944.5.1.24',
        }),
      ],
    )[0].divisions[0].template;

    expect(template).toMatchObject({
      obsolete: true,
      obsoleteDate: '1944.5.1.24',
    });
  });

  test('keeps duplicate visible template names attached to distinct refs', () => {
    const divisions = aggregateDivisions(
      [
        divisionRecord({
          divisionRef: { id: 1, type: 51 },
          divisionTemplateRef: { id: 100, type: 52 },
        }),
        divisionRecord({
          divisionRef: { id: 2, type: 51 },
          divisionTemplateRef: { id: 200, type: 52 },
        }),
      ],
      DIVISION_AGGREGATION_TEMPLATES,
    )[0].divisions;

    expect(divisions.map(({ template }) => template?.name)).toEqual([
      'Duplicate Template Name',
      'Duplicate Template Name',
    ]);
    expect(divisions.map(({ template }) => template?.templateRef)).toEqual([
      { id: 100, type: 52 },
      { id: 200, type: 52 },
    ]);
  });

  test('keeps divisions with duplicate literal names separate', () => {
    const divisions = aggregateDivisions(
      [
        divisionRecord({ divisionRef: { id: 1, type: 51 } }),
        divisionRecord({ divisionRef: { id: 2, type: 51 } }),
      ],
      [divisionTemplate()],
    )[0].divisions;

    expect(divisions).toHaveLength(2);
    expect(divisions.map(({ divisionRef }) => divisionRef?.id)).toEqual([1, 2]);
  });

  test('keeps a missing division template ref with template null', () => {
    const division = aggregateDivisions(
      [divisionRecord({ divisionTemplateRef: null })],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division.template).toBeNull();
    expect(division.warnings).toContain('missing division template reference');
  });

  test('preserves an unresolved template ref with a focused warning', () => {
    const division = aggregateDivisions(
      [divisionRecord({ divisionTemplateRef: { id: 999, type: 52 } })],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division.divisionTemplateRef).toEqual({ id: 999, type: 52 });
    expect(division.template).toBeNull();
    expect(division.warnings).toContain(
      'unresolved division template reference: 52:999',
    );
  });

  test('resolves duplicate template refs to earliest sourceOffset and warns', () => {
    const division = aggregateDivisions(
      [divisionRecord()],
      [
        divisionTemplate({ name: 'Later', sourceOffset: 300 }),
        divisionTemplate({ name: 'Earlier', sourceOffset: 100 }),
      ],
    )[0].divisions[0];

    expect(division.template?.name).toBe('Earlier');
    expect(division.warnings).toContain(
      'ambiguous division template reference: 52:100; using source offset 100',
    );
  });

  test('preserves current manpower', () => {
    expect(
      aggregateDivisions([divisionRecord()], [divisionTemplate()])[0]
        .divisions[0].currentManpower,
    ).toBe(80);
  });

  test('preserves required manpower', () => {
    expect(
      aggregateDivisions([divisionRecord()], [divisionTemplate()])[0]
        .divisions[0].requiredManpower,
    ).toBe(100);
  });

  test('derives missing manpower with a zero floor', () => {
    expect(
      aggregateDivisions([divisionRecord()], [divisionTemplate()])[0]
        .divisions[0].missingManpower,
    ).toBe(20);
  });

  test('derives manpower completeness from current and required values', () => {
    expect(
      aggregateDivisions([divisionRecord()], [divisionTemplate()])[0]
        .divisions[0].manpowerCompleteness,
    ).toBe(0.8);
  });

  test('returns null manpower derivations when current manpower is missing', () => {
    const division = aggregateDivisions(
      [
        divisionRecord({
          manpower: {
            current: null,
            required: 100,
            currentTag: null,
            requiredTag: 'GER',
          },
        }),
      ],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division.missingManpower).toBeNull();
    expect(division.manpowerCompleteness).toBeNull();
  });

  test('returns null manpower derivations when required manpower is missing', () => {
    const division = aggregateDivisions(
      [
        divisionRecord({
          manpower: {
            current: 80,
            required: null,
            currentTag: 'GER',
            requiredTag: null,
          },
        }),
      ],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division.missingManpower).toBeNull();
    expect(division.manpowerCompleteness).toBeNull();
  });

  test('returns null completeness when required manpower is zero', () => {
    const division = aggregateDivisions(
      [
        divisionRecord({
          manpower: {
            current: 0,
            required: 0,
            currentTag: 'GER',
            requiredTag: 'GER',
          },
        }),
      ],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division.missingManpower).toBe(0);
    expect(division.manpowerCompleteness).toBeNull();
  });

  test('does not clamp manpower completeness when current exceeds required', () => {
    const division = aggregateDivisions(
      [
        divisionRecord({
          manpower: {
            current: 120,
            required: 100,
            currentTag: 'GER',
            requiredTag: 'GER',
          },
        }),
      ],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division.missingManpower).toBe(0);
    expect(division.manpowerCompleteness).toBe(1.2);
  });

  test('preserves raw strength above 100', () => {
    expect(
      aggregateDivisions([divisionRecord()], [divisionTemplate()])[0]
        .divisions[0].strength,
    ).toBe(150);
  });

  test('preserves raw organization unchanged', () => {
    expect(
      aggregateDivisions([divisionRecord()], [divisionTemplate()])[0]
        .divisions[0].organization,
    ).toBe(32.5);
  });

  test('preserves raw experience unchanged', () => {
    expect(
      aggregateDivisions([divisionRecord()], [divisionTemplate()])[0]
        .divisions[0].experience,
    ).toBe(1200);
  });

  test('preserves current equipment entries', () => {
    const equipment = aggregateDivisions(
      [divisionRecord()],
      [divisionTemplate()],
    )[0].divisions[0].equipment;

    expect(equipment).toHaveLength(1);
    expect(equipment[0]).toMatchObject({
      equipmentRef: { id: 500, type: 70 },
      amount: 800,
      equipment: { definition: 'infantry_equipment_2' },
    });
  });

  test('keeps multiple exact equipment variants distinct', () => {
    const equipment = [
      divisionEquipment(),
      divisionEquipment({
        equipmentRef: { id: 501, type: 70 },
        equipment: divisionEquipmentDefinition({
          equipmentRef: { id: 501, type: 70 },
          name: 'Rifle Variant B',
        }),
        amount: 25,
      }),
    ];
    const resolved = aggregateDivisions(
      [divisionRecord({ equipment })],
      [divisionTemplate()],
    )[0].divisions[0].equipment;

    expect(resolved.map(({ equipmentRef }) => equipmentRef)).toEqual([
      { id: 500, type: 70 },
      { id: 501, type: 70 },
    ]);
  });

  test('preserves unresolved equipment records', () => {
    const equipment = divisionEquipment({
      equipmentRef: { id: 999, type: 70 },
      equipment: null,
      warnings: ['unresolved equipment reference: 70:999'],
    });
    const resolved = aggregateDivisions(
      [divisionRecord({ equipment: [equipment] })],
      [divisionTemplate()],
    )[0].divisions[0].equipment[0];

    expect(resolved.equipment).toBeNull();
    expect(resolved.equipmentRef).toEqual({ id: 999, type: 70 });
    expect(resolved.warnings).toContain(
      'unresolved equipment reference: 70:999',
    );
  });

  test('preserves the numeric province ID', () => {
    expect(
      aggregateDivisions([divisionRecord()], [divisionTemplate()])[0]
        .divisions[0].provinceId,
    ).toBe(1234);
  });

  test('derives supply ratio when current and positive max are available', () => {
    expect(
      aggregateDivisions([divisionRecord()], [divisionTemplate()])[0]
        .divisions[0].supplyRatio,
    ).toBe(0.8);
  });

  test('does not clamp supply ratio when current exceeds max', () => {
    const division = aggregateDivisions(
      [
        divisionRecord({
          supply: {
            current: 120,
            max: 100,
            gain: 0,
            outOfSupplyDays: null,
            disrupted: null,
          },
        }),
      ],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division.supplyRatio).toBe(1.2);
  });

  test('returns null supply ratio when max supply is missing', () => {
    const division = aggregateDivisions(
      [
        divisionRecord({
          supply: {
            current: 80,
            max: null,
            gain: null,
            outOfSupplyDays: null,
            disrupted: null,
          },
        }),
      ],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division.supplyRatio).toBeNull();
  });

  test('returns null supply ratio when max supply is zero', () => {
    const division = aggregateDivisions(
      [
        divisionRecord({
          supply: {
            current: 10,
            max: 0,
            gain: null,
            outOfSupplyDays: null,
            disrupted: null,
          },
        }),
      ],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division.supplyRatio).toBeNull();
  });

  test('preserves fuel and fuelRequested independently', () => {
    expect(
      aggregateDivisions([divisionRecord()], [divisionTemplate()])[0]
        .divisions[0],
    ).toMatchObject({ fuel: 4, fuelRequested: 1 });
  });

  test('keeps missing fuel as null', () => {
    const division = aggregateDivisions(
      [divisionRecord({ fuel: null, fuelRequested: null })],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division).toMatchObject({ fuel: null, fuelRequested: null });
  });

  test('preserves expeditionary owner separately from the controller', () => {
    const division = aggregateDivisions(
      [divisionRecord({ expeditionaryOwnerTag: 'FRA' })],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division.countryTag).toBe('GER');
    expect(division.expeditionaryOwnerTag).toBe('FRA');
  });

  test('preserves foreign current and required manpower tags', () => {
    const division = aggregateDivisions(
      [
        divisionRecord({
          manpower: {
            current: 80,
            required: 100,
            currentTag: 'FRA',
            requiredTag: 'FRA',
          },
        }),
      ],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division.currentManpowerTag).toBe('FRA');
    expect(division.requiredManpowerTag).toBe('FRA');
  });

  test('preserves directly stored status fields', () => {
    expect(
      aggregateDivisions([divisionRecord()], [divisionTemplate()])[0]
        .divisions[0].status,
    ).toEqual({
      strategicRedeployment: false,
      retreat: false,
      supportAttack: 700,
    });
  });

  test('conserves valid country manpower totals and derived gaps', () => {
    const country = aggregateDivisions(
      [
        divisionRecord({
          divisionRef: { id: 1, type: 51 },
          manpower: {
            current: 80,
            required: 100,
            currentTag: 'GER',
            requiredTag: 'GER',
          },
        }),
        divisionRecord({
          divisionRef: { id: 2, type: 51 },
          manpower: {
            current: 50,
            required: 50,
            currentTag: 'GER',
            requiredTag: 'GER',
          },
        }),
      ],
      [divisionTemplate()],
    )[0];

    expect(country).toMatchObject({
      currentManpowerTotal: 130,
      requiredManpowerTotal: 150,
      missingManpowerTotal: 20,
      fullManpowerDivisionCount: 1,
      underManpowerDivisionCount: 1,
    });
  });

  test('conserves division count', () => {
    const countries = aggregateDivisions(
      DIVISION_AGGREGATION_RECORDS,
      DIVISION_AGGREGATION_TEMPLATES,
    );

    expect(
      countries.reduce((sum, country) => sum + country.divisionCount, 0),
    ).toBe(DIVISION_AGGREGATION_RECORDS.length);
  });

  test('sorts countries by exact tag ascending', () => {
    const countries = aggregateDivisions(
      [
        divisionRecord({ countryTag: 'USA' }),
        divisionRecord({ countryTag: 'D04' }),
        divisionRecord({ countryTag: 'GER' }),
      ],
      [divisionTemplate()],
    );

    expect(countries.map(({ countryTag }) => countryTag)).toEqual([
      'D04',
      'GER',
      'USA',
    ]);
  });

  test('sorts divisions by name, then ref, with null names last', () => {
    const records = [
      divisionRecord({
        divisionRef: { id: 3, type: 51 },
        name: { overrideName: 'Zulu', type: 0, order: null },
        sourceOffset: 300,
      }),
      divisionRecord({
        divisionRef: { id: 1, type: 51 },
        name: { overrideName: null, type: 0, order: 1 },
        sourceOffset: 100,
      }),
      divisionRecord({
        divisionRef: { id: 9, type: 51 },
        name: { overrideName: 'Alpha', type: 0, order: null },
        sourceOffset: 900,
      }),
      divisionRecord({
        divisionRef: { id: 2, type: 51 },
        name: { overrideName: 'Alpha', type: 0, order: null },
        sourceOffset: 200,
      }),
    ];

    expect(
      aggregateDivisions(records, [divisionTemplate()])[0].divisions.map(
        ({ divisionRef }) => divisionRef?.id,
      ),
    ).toEqual([2, 9, 3, 1]);
  });

  test('does not mutate raw division records', () => {
    const records = [
      divisionRecord({
        divisionRef: { id: 2, type: 51 },
        name: { overrideName: 'Zulu', type: 0, order: null },
      }),
      divisionRecord({
        divisionRef: { id: 1, type: 51 },
        name: { overrideName: 'Alpha', type: 0, order: null },
      }),
    ];
    const before = JSON.stringify(records);

    aggregateDivisions(records, [divisionTemplate()]);

    expect(JSON.stringify(records)).toBe(before);
  });

  test('does not mutate the template registry', () => {
    const templates = [
      divisionTemplate({ name: 'Later', sourceOffset: 300 }),
      divisionTemplate({ name: 'Earlier', sourceOffset: 100 }),
    ];
    const before = JSON.stringify(templates);

    aggregateDivisions([divisionRecord()], templates);

    expect(JSON.stringify(templates)).toBe(before);
  });

  test('does not expose a readiness or combat-effectiveness score', () => {
    const division = aggregateDivisions(
      [divisionRecord()],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division).not.toHaveProperty('readiness');
    expect(division).not.toHaveProperty('readinessScore');
    expect(division).not.toHaveProperty('combatReadiness');
    expect(division).not.toHaveProperty('combatEffectiveness');
  });

  test('does not expose equipment requirement or completeness fields', () => {
    const division = aggregateDivisions(
      [divisionRecord()],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division).not.toHaveProperty('requiredEquipment');
    expect(division).not.toHaveProperty('missingEquipment');
    expect(division).not.toHaveProperty('equipmentCompleteness');
  });

  test('does not expose strength or organization percentages', () => {
    const division = aggregateDivisions(
      [divisionRecord()],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division).not.toHaveProperty('strengthPercentage');
    expect(division).not.toHaveProperty('strengthCompleteness');
    expect(division).not.toHaveProperty('organizationPercentage');
    expect(division).not.toHaveProperty('organizationCompleteness');
  });

  test('flattens exact raw name descriptor fields without generating a name', () => {
    const division = aggregateDivisions(
      [
        divisionRecord({
          name: { overrideName: null, type: 7, order: 42 },
        }),
      ],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division).toMatchObject({
      overrideName: null,
      nameType: 7,
      nameOrder: 42,
    });
  });

  test('safely preserves a division with a missing division identity', () => {
    const division = aggregateDivisions(
      [divisionRecord({ divisionRef: null })],
      [divisionTemplate()],
    )[0].divisions[0];

    expect(division.divisionRef).toBeNull();
    expect(division.template).not.toBeNull();
  });

  test('attaches partial template metadata and surfaces its partial state', () => {
    const division = aggregateDivisions(
      [divisionRecord()],
      [
        divisionTemplate({
          complete: false,
          countryTag: null,
          warnings: ['missing country'],
        }),
      ],
    )[0].divisions[0];

    expect(division.template).toMatchObject({
      countryTag: null,
      complete: false,
      warnings: ['missing country'],
    });
    expect(division.complete).toBe(false);
    expect(division.warnings).toContain(
      'resolved division template is partial: 52:100',
    );
  });

  test('reports resolved and unresolved template counts per country', () => {
    const country = aggregateDivisions(
      [
        divisionRecord({ divisionRef: { id: 1, type: 51 } }),
        divisionRecord({
          divisionRef: { id: 2, type: 51 },
          divisionTemplateRef: { id: 999, type: 52 },
        }),
      ],
      [divisionTemplate()],
    )[0];

    expect(country).toMatchObject({
      resolvedTemplateCount: 1,
      unresolvedTemplateCount: 1,
    });
  });

  test('returns an empty result for no divisions', () => {
    expect(aggregateDivisions([], [divisionTemplate()])).toEqual([]);
  });

  test('is deterministic for identical inputs', () => {
    expect(
      aggregateDivisions(
        DIVISION_AGGREGATION_RECORDS,
        DIVISION_AGGREGATION_TEMPLATES,
      ),
    ).toEqual(
      aggregateDivisions(
        DIVISION_AGGREGATION_RECORDS,
        DIVISION_AGGREGATION_TEMPLATES,
      ),
    );
  });
});
