import { findDirectBlocks } from '../naval-loss/global-history.parser';
import { aggregateDivisions } from './division.aggregator';
import { linkArmyHierarchy, parseArmyHierarchy } from './army.parser';
import type { CountryDivisionSummary } from './division.types';
import {
  ARMY_HIERARCHY_FIXTURE,
  DUPLICATE_ARMY_HIERARCHY_FIXTURE,
  MALFORMED_ARMY_HIERARCHY_FIXTURE,
} from './fixtures/army.fixture';
import {
  divisionRecord,
  divisionTemplate,
} from './fixtures/division-aggregation.fixture';

function divisionCountries(): CountryDivisionSummary[] {
  return aggregateDivisions(
    [
      divisionRecord({
        countryTag: 'GER',
        divisionRef: { id: 1, type: 51 },
        name: { overrideName: 'Division One', type: 0, order: null },
        sourceOffset: 101,
      }),
      divisionRecord({
        countryTag: 'GER',
        divisionRef: { id: 2, type: 4713 },
        name: { overrideName: 'Division Two', type: 0, order: null },
        sourceOffset: 102,
      }),
      divisionRecord({
        countryTag: 'GER',
        divisionRef: { id: 3, type: 51 },
        name: { overrideName: 'Division Three', type: 0, order: null },
        sourceOffset: 103,
      }),
      divisionRecord({
        countryTag: 'D04',
        logicalCountryTag: 'D04',
        divisionRef: { id: 4, type: 4713 },
        name: { overrideName: 'Dynamic Division', type: 0, order: null },
        sourceOffset: 104,
      }),
      divisionRecord({
        countryTag: 'ENG',
        logicalCountryTag: 'ENG',
        expeditionaryOwnerTag: 'FRA',
        divisionRef: { id: 5, type: 51 },
        name: { overrideName: 'Foreign Division', type: 0, order: null },
        manpower: {
          current: 75,
          required: 100,
          currentTag: 'FRA',
          requiredTag: 'FRA',
        },
        sourceOffset: 105,
      }),
      divisionRecord({
        countryTag: 'ITA',
        logicalCountryTag: 'ITA',
        divisionRef: { id: 6, type: 51 },
        name: { overrideName: 'Unassigned Division', type: 0, order: null },
        sourceOffset: 106,
      }),
    ],
    [divisionTemplate()],
  );
}

describe('parseArmyHierarchy', () => {
  test('parses only the exact countries.TAG.theatres.theatre hierarchy', () => {
    const hierarchy = parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE);

    expect(hierarchy.armies).toHaveLength(4);
    expect(hierarchy.armies.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining(['Nested lookalike', 'History lookalike']),
    );
  });

  test('preserves army source order', () => {
    const armies = parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE).armies;

    expect(armies.map(({ armyRef }) => armyRef?.id)).toEqual([
      100, 101, 300, 400,
    ]);
    expect(armies.map(({ sourceOffset }) => sourceOffset)).toEqual(
      [...armies.map(({ sourceOffset }) => sourceOffset)].sort(
        (left, right) => left - right,
      ),
    );
  });

  test('preserves exact army identity', () => {
    expect(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE).armies[0].armyRef,
    ).toEqual({ id: 100, type: 53 });
  });

  test('captures exact army country including dynamic tags', () => {
    expect(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE).armies.map(
        ({ countryTag }) => countryTag,
      ),
    ).toEqual(['GER', 'GER', 'SOV', 'D04']);
  });

  test('preserves the containing theatre reference', () => {
    expect(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE).armies[0].theaterRef,
    ).toEqual({ id: 1, type: 67 });
  });

  test('preserves raw army names and missing names', () => {
    const armies = parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE).armies;

    expect(armies[0].name).toBe('Army Alpha');
    expect(armies[1].name).toBeNull();
  });

  test('preserves direct division memberships in source order', () => {
    expect(
      parseArmyHierarchy(
        ARMY_HIERARCHY_FIXTURE,
      ).armies[0].divisionMemberships.map(({ divisionRef }) => divisionRef),
    ).toEqual([
      { id: 1, type: 51 },
      { id: 2, type: 4713 },
      { id: 5, type: 51 },
    ]);
  });

  test('preserves commander and leader-unit references independently', () => {
    expect(parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE).armies[0]).toMatchObject({
      commanderRef: { id: 10, type: 4713 },
      leaderUnitRef: { id: 1, type: 51 },
    });
  });

  test('parses field_marshal_group as a separate army-group record', () => {
    const group = parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE).armyGroups[0];

    expect(group).toMatchObject({
      armyGroupRef: { id: 200, type: 53 },
      countryTag: 'GER',
      name: 'Army Group Alpha',
      commanderRef: { id: 20, type: 4713 },
      theaterRef: { id: 1, type: 67 },
    });
  });

  test('preserves exact army-group membership references', () => {
    expect(
      parseArmyHierarchy(
        ARMY_HIERARCHY_FIXTURE,
      ).armyGroups[0].armyMemberships.map(({ armyRef }) => armyRef),
    ).toEqual([
      { id: 100, type: 53 },
      { id: 101, type: 53 },
    ]);
  });

  test('resolves commander registry source fields without linkage', () => {
    const commander = parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE).commanders[0];

    expect(commander).toMatchObject({
      commanderRef: { id: 10, type: 4713 },
      characterRef: { id: 1, type: 73 },
      countryTag: 'GER',
      name: 'Duplicate Commander Name',
      characterName: 'Duplicate Commander Name',
      role: 'corps_commander',
      source: 'historical',
      skill: 3,
    });
  });

  test('preserves raw commander traits', () => {
    expect(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE).commanders[0].traits,
    ).toEqual(['organizer', 'custom_general_trait']);
  });

  test('parses dynamic commanders', () => {
    expect(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE).commanders,
    ).toContainEqual(
      expect.objectContaining({
        commanderRef: { id: 40, type: 4713 },
        countryTag: 'D04',
        source: 'dynamic',
      }),
    );
  });

  test('keeps duplicate commander names separate by exact ref', () => {
    const commanders = parseArmyHierarchy(
      ARMY_HIERARCHY_FIXTURE,
    ).commanders.filter(({ name }) => name === 'Duplicate Commander Name');

    expect(commanders.map(({ commanderRef }) => commanderRef)).toEqual([
      { id: 10, type: 4713 },
      { id: 20, type: 4713 },
    ]);
  });

  test('preserves explicit absence of an army commander as null', () => {
    expect(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE).armies[1].commanderRef,
    ).toBeNull();
  });

  test('ignores nested character and command lookalikes', () => {
    const hierarchy = parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE);

    expect(hierarchy.commanders.map(({ name }) => name)).not.toContain(
      'Nested lookalike',
    );
    expect(hierarchy.armies.map(({ armyRef }) => armyRef?.id)).not.toContain(
      997,
    );
  });

  test('keeps malformed records partial and continues with later records', () => {
    const hierarchy = parseArmyHierarchy(MALFORMED_ARMY_HIERARCHY_FIXTURE);

    expect(hierarchy.armies).toHaveLength(2);
    expect(hierarchy.armies[0]).toMatchObject({
      armyRef: null,
      complete: false,
    });
    expect(hierarchy.armies[1]).toMatchObject({
      armyRef: { id: 800, type: 53 },
      name: 'Valid Later Army',
    });
    expect(hierarchy.commanders.at(-1)?.name).toBe('Valid Later Commander');
    expect(hierarchy.armyGroups.at(-1)?.name).toBe('Valid Later Group');
  });

  test('warns on malformed refs and numeric commander fields', () => {
    const hierarchy = parseArmyHierarchy(MALFORMED_ARMY_HIERARCHY_FIXTURE);

    expect(hierarchy.armies[0].warnings).toEqual(
      expect.arrayContaining([
        'invalid id.id: broken',
        'member[0]: invalid unit.id: broken',
      ]),
    );
    expect(hierarchy.commanders[0].warnings).toEqual(
      expect.arrayContaining([
        'invalid id.id: broken',
        'invalid skill: broken',
      ]),
    );
  });

  test('preserves duplicate canonical refs and warns on later records', () => {
    const hierarchy = parseArmyHierarchy(DUPLICATE_ARMY_HIERARCHY_FIXTURE);

    expect(hierarchy.armies).toHaveLength(2);
    expect(hierarchy.armyGroups).toHaveLength(2);
    expect(hierarchy.commanders).toHaveLength(2);
    expect(hierarchy.armies[1].warnings).toContain(
      'duplicate army reference: 53:100',
    );
    expect(hierarchy.armyGroups[1].warnings).toContain(
      'duplicate army group reference: 53:200',
    );
    expect(hierarchy.commanders[1].warnings).toContain(
      'duplicate commander reference: 4713:10',
    );
  });

  test('accepts and reuses an existing top-level block index', () => {
    const topLevelBlocks = findDirectBlocks(
      ARMY_HIERARCHY_FIXTURE,
      0,
      ARMY_HIERARCHY_FIXTURE.length,
    );

    expect(parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE, topLevelBlocks)).toEqual(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
    );
  });

  test('does not mutate decoded text or supplied top-level blocks', () => {
    const text = ARMY_HIERARCHY_FIXTURE;
    const topLevelBlocks = findDirectBlocks(text, 0, text.length);
    const blocksBefore = JSON.stringify(topLevelBlocks);

    parseArmyHierarchy(text, topLevelBlocks);

    expect(text).toBe(ARMY_HIERARCHY_FIXTURE);
    expect(JSON.stringify(topLevelBlocks)).toBe(blocksBefore);
  });

  test('is deterministic for identical parser inputs', () => {
    expect(parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE)).toEqual(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
    );
  });
});

describe('linkArmyHierarchy', () => {
  test('links exact canonical divisions to their authoritative army membership', () => {
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
      divisionCountries(),
    );
    const army = countries
      .find(({ countryTag }) => countryTag === 'GER')
      ?.armies.find(({ army }) => army.armyRef?.id === 100);

    expect(army?.divisions.map(({ divisionRef }) => divisionRef)).toEqual([
      { id: 1, type: 51 },
      { id: 2, type: 4713 },
      { id: 5, type: 51 },
    ]);
  });

  test('keeps divisions with no army in unassignedDivisions', () => {
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
      divisionCountries(),
    );
    const italy = countries.find(({ countryTag }) => countryTag === 'ITA');

    expect(italy?.unassignedDivisions[0].divisionRef).toEqual({
      id: 6,
      type: 51,
    });
  });

  test('preserves unresolved division membership refs on the army', () => {
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
      divisionCountries(),
    );
    const army = countries.find(({ countryTag }) => countryTag === 'SOV')
      ?.armies[0];

    expect(army?.unresolvedDivisionRefs).toEqual([{ id: 99, type: 51 }]);
    expect(army?.warnings).toContain(
      'unresolved division membership reference: 51:99',
    );
  });

  test('selects earliest army deterministically for duplicate division membership', () => {
    const hierarchy = parseArmyHierarchy(DUPLICATE_ARMY_HIERARCHY_FIXTURE);
    const countries = linkArmyHierarchy(
      hierarchy,
      aggregateDivisions(
        [divisionRecord({ divisionRef: { id: 1, type: 51 } })],
        [divisionTemplate()],
      ),
    );
    const armies = countries[0].armies;

    expect(armies[0].divisions).toHaveLength(1);
    expect(armies[1].divisions).toHaveLength(0);
    expect(armies[0].ambiguousDivisionRefs).toEqual([{ id: 1, type: 51 }]);
    expect(armies[1].ambiguousDivisionRefs).toEqual([{ id: 1, type: 51 }]);
  });

  test('links an army to its exact parent field-marshal group', () => {
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
      divisionCountries(),
    );
    const army = countries.find(({ countryTag }) => countryTag === 'GER')
      ?.armies[0];

    expect(army?.parentArmyGroup?.armyGroupRef).toEqual({ id: 200, type: 53 });
  });

  test('keeps an army without a parent group as null without warning', () => {
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
      divisionCountries(),
    );
    const army = countries.find(({ countryTag }) => countryTag === 'SOV')
      ?.armies[0];

    expect(army?.parentArmyGroup).toBeNull();
    expect(
      army?.warnings.some((warning) => warning.includes('parent army group')),
    ).toBe(false);
  });

  test('preserves unresolved group-to-army references', () => {
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
      divisionCountries(),
    );
    const group = countries.find(({ countryTag }) => countryTag === 'D04')
      ?.armyGroups[0];

    expect(group?.unresolvedArmyRefs).toEqual([{ id: 999, type: 53 }]);
    expect(group?.warnings).toContain(
      'unresolved army group membership reference: 53:999',
    );
  });

  test('resolves army commander by exact ref', () => {
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
      divisionCountries(),
    );
    const army = countries.find(({ countryTag }) => countryTag === 'GER')
      ?.armies[0];

    expect(army?.commander?.commanderRef).toEqual({ id: 10, type: 4713 });
    expect(army?.commander?.role).toBe('corps_commander');
  });

  test('resolves army-group commander independently', () => {
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
      divisionCountries(),
    );
    const group = countries.find(({ countryTag }) => countryTag === 'GER')
      ?.armyGroups[0];

    expect(group?.commander?.commanderRef).toEqual({ id: 20, type: 4713 });
    expect(group?.commander?.role).toBe('field_marshal');
  });

  test('treats missing commander as explicit null without an unresolved warning', () => {
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
      divisionCountries(),
    );
    const army = countries
      .find(({ countryTag }) => countryTag === 'GER')
      ?.armies.find(({ army }) => army.armyRef?.id === 101);

    expect(army?.commander).toBeNull();
    expect(
      army?.warnings.some((warning) => warning.includes('commander')),
    ).toBe(false);
  });

  test('warns and preserves an unresolved commander ref', () => {
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
      divisionCountries(),
    );
    const army = countries.find(({ countryTag }) => countryTag === 'SOV')
      ?.armies[0];

    expect(army?.army.commanderRef).toEqual({ id: 999, type: 4713 });
    expect(army?.commander).toBeNull();
    expect(army?.warnings).toContain(
      'unresolved commander reference: 4713:999',
    );
  });

  test('selects earliest commander deterministically for duplicate refs', () => {
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(DUPLICATE_ARMY_HIERARCHY_FIXTURE),
      aggregateDivisions(
        [divisionRecord({ divisionRef: { id: 1, type: 51 } })],
        [divisionTemplate()],
      ),
    );

    expect(countries[0].armies[0].commander?.name).toBe('Earlier Commander');
    expect(countries[0].armies[0].warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('ambiguous commander reference: 4713:10'),
      ]),
    );
  });

  test('does not resolve commanders by duplicate names', () => {
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
      divisionCountries(),
    );
    const germany = countries.find(({ countryTag }) => countryTag === 'GER');

    expect(germany?.armies[0].commander?.commanderRef?.id).toBe(10);
    expect(germany?.armyGroups[0].commander?.commanderRef?.id).toBe(20);
  });

  test('supports dynamic country tags throughout parsing and linkage', () => {
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
      divisionCountries(),
    );
    const dynamic = countries.find(({ countryTag }) => countryTag === 'D04');

    expect(dynamic?.armies[0].commander?.countryTag).toBe('D04');
    expect(dynamic?.armies[0].divisions[0].countryTag).toBe('D04');
  });

  test('preserves cross-country controller and expeditionary provenance', () => {
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
      divisionCountries(),
    );
    const foreignDivision = countries
      .find(({ countryTag }) => countryTag === 'GER')
      ?.armies[0].divisions.find(({ divisionRef }) => divisionRef?.id === 5);

    expect(foreignDivision).toMatchObject({
      countryTag: 'ENG',
      logicalCountryTag: 'ENG',
      expeditionaryOwnerTag: 'FRA',
      currentManpowerTag: 'FRA',
      requiredManpowerTag: 'FRA',
    });
  });

  test('conserves linked plus unassigned canonical divisions', () => {
    const input = divisionCountries();
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
      input,
    );
    const rawCount = input.reduce(
      (sum, country) => sum + country.divisionCount,
      0,
    );

    expect(
      countries.reduce(
        (sum, country) =>
          sum + country.linkedDivisionCount + country.unassignedDivisionCount,
        0,
      ),
    ).toBe(rawCount);
  });

  test('does not duplicate division summaries during linkage', () => {
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
      divisionCountries(),
    );
    const all = countries.flatMap((country) => [
      ...country.armies.flatMap(({ divisions }) => divisions),
      ...country.unassignedDivisions,
    ]);

    expect(new Set(all.map(({ sourceOffset }) => sourceOffset)).size).toBe(
      all.length,
    );
  });

  test('preserves PR 3 manpower, equipment, templates and controller fields', () => {
    const input = divisionCountries();
    const original = input
      .flatMap(({ divisions }) => divisions)
      .find(({ divisionRef }) => divisionRef?.id === 5);
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
      input,
    );
    const linked = countries
      .flatMap(({ armies }) => armies)
      .flatMap(({ divisions }) => divisions)
      .find(({ divisionRef }) => divisionRef?.id === 5);

    expect(linked).toBe(original);
    expect(linked?.currentManpower).toBe(75);
    expect(linked?.equipment).toEqual(original?.equipment);
    expect(linked?.template).toEqual(original?.template);
    expect(linked?.countryTag).toBe('ENG');
  });

  test('does not mutate hierarchy or Division PR 3 inputs', () => {
    const hierarchy = parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE);
    const input = divisionCountries();
    const hierarchyBefore = JSON.stringify(hierarchy);
    const divisionsBefore = JSON.stringify(input);

    linkArmyHierarchy(hierarchy, input);

    expect(JSON.stringify(hierarchy)).toBe(hierarchyBefore);
    expect(JSON.stringify(input)).toBe(divisionsBefore);
  });

  test('does not expose combat, readiness, order or inferred quality fields', () => {
    const countries = linkArmyHierarchy(
      parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE),
      divisionCountries(),
    );
    const army = countries[0].armies[0];

    expect(army).not.toHaveProperty('readiness');
    expect(army).not.toHaveProperty('combatPower');
    expect(army).not.toHaveProperty('commanderRating');
    expect(army.army).not.toHaveProperty('orderInstances');
    expect(army.army).not.toHaveProperty('fronts');
  });

  test('is deterministic for identical linkage inputs', () => {
    const hierarchy = parseArmyHierarchy(ARMY_HIERARCHY_FIXTURE);
    const input = divisionCountries();

    expect(linkArmyHierarchy(hierarchy, input)).toEqual(
      linkArmyHierarchy(hierarchy, input),
    );
  });
});
