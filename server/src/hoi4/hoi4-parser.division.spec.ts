import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DIVISION_TEMPLATE_FIXTURE } from './division/fixtures/division-template.fixture';
import { DIVISION_FIXTURE } from './division/fixtures/division.fixture';
import { analyzeSave, type AnalyzeResult } from './hoi4-parser';

const INTEGRATION_HIERARCHY_FIXTURE = `
division_templates={
  division_template={
    id={ id=102 type=52 }
    name="Foreign Template"
    country="D04"
    original_tag="D04"
    foreign_template_tag="RKN"
    role="modded_role"
    regiments={ modded_battalion={ x=0 y=0 } }
  }
}
countries={
  USA={
    theatres={
      theatre={
        id={ id=1 type=53 }
        orders_group={
          id={ id=100 type=53 }
          name="Army 1"
          leader={ id=500 type=54 }
          member={ unit={ id=1 type=51 } }
          member={ unit={ id=2 type=4713 } }
        }
        orders_group={
          id={ id=101 type=53 }
          name="Unresolved Army"
          member={ unit={ id=999 type=51 } }
        }
        orders_group={
          id={ id=broken type=53 }
          name="Partial Army"
          member={ unit={ id=broken type=51 } }
        }
        field_marshal_group={
          id={ id=200 type=53 }
          name="Army Group 1"
          leader={ id=501 type=54 }
          orders_group={ id=100 type=53 }
        }
        field_marshal_group={
          id={ id=201 type=53 }
          name="Uncommanded Group"
        }
      }
    }
  }
  D04={
    theatres={
      theatre={
        id={ id=2 type=53 }
        orders_group={ id={ id=300 type=53 } name="Groupless Army" }
      }
    }
  }
}
character_manager={
  historical={
    character={
      id={ id=900 type=50 }
      country="USA"
      name="USA_general_character"
      corps_commander={
        id={ id=500 type=54 }
        name="USA_general"
        skill=4
        traits={ organizer }
      }
    }
    character={
      id={ id=901 type=50 }
      country="USA"
      name="USA_field_marshal_character"
      field_marshal={
        id={ id=501 type=54 }
        name="USA_field_marshal"
        skill=5
        traits={ offensive_doctrine }
      }
    }
  }
}
`;

describe('analyzeSave division integration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hoi4-division-integration-'));
  const populatedPath = join(directory, 'populated.hoi4');
  const emptyPath = join(directory, 'empty.hoi4');
  let result: AnalyzeResult;

  beforeAll(() => {
    writeFileSync(
      populatedPath,
      `${DIVISION_FIXTURE}\n${DIVISION_TEMPLATE_FIXTURE}\n${INTEGRATION_HIERARCHY_FIXTURE}`,
      'utf8',
    );
    writeFileSync(emptyPath, 'HOI4txt\ndate="1944.5.1.1"', 'utf8');
    result = analyzeSave(populatedPath);
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  test('returns non-optional empty division and hierarchy summaries', () => {
    const empty = analyzeSave(emptyPath);

    expect(empty.divisionSummaries).toEqual([]);
    expect(empty.armyHierarchySummaries).toEqual([]);
  });

  test('resolves exact templates and preserves their raw metadata', () => {
    const usa = result.divisionSummaries.find(
      ({ countryTag }) => countryTag === 'USA',
    );
    const division = usa?.divisions.find(
      ({ divisionRef }) => divisionRef?.id === 1 && divisionRef.type === 51,
    );

    expect(division?.divisionTemplateRef).toEqual({ id: 100, type: 52 });
    expect(division?.template).toMatchObject({
      templateRef: { id: 100, type: 52 },
      name: 'Duplicate Name',
      role: 'infantry',
      countryTag: 'GER',
      originalTag: 'GER',
      foreignTemplateTag: '---',
      obsolete: false,
    });
    expect(division?.template?.regiments).toHaveLength(3);
    expect(division?.template?.supportCompanies).toHaveLength(2);
    expect(division?.template?.regimentalSupport).toHaveLength(1);

    const obsoleteTemplate = usa?.divisions.find(
      ({ divisionRef }) => divisionRef?.id === 2,
    )?.template;
    expect(obsoleteTemplate).toMatchObject({
      obsolete: true,
      obsoleteChangeDate: '1944.5.1.24',
    });
  });

  test('preserves manpower derivations and raw division snapshot fields', () => {
    const division = result.divisionSummaries.find(
      ({ countryTag }) => countryTag === 'D04',
    )?.divisions[0];

    expect(division).toMatchObject({
      countryTag: 'D04',
      logicalCountryTag: 'D04',
      expeditionaryOwnerTag: 'RKN',
      currentManpower: 6400,
      requiredManpower: 6500,
      currentManpowerTag: 'RKN',
      requiredManpowerTag: 'RKN',
      missingManpower: 100,
      manpowerCompleteness: 6400 / 6500,
      strength: 151,
      organization: 12,
      experience: 639.639,
      provinceId: 6449,
      supply: {
        current: 0,
        max: 108,
        gain: 0.04,
        outOfSupplyDays: null,
        disrupted: null,
      },
      supplyRatio: 0,
      fuel: null,
      fuelRequested: null,
    });
  });

  test('preserves raw supply, fuel, and direct status fields', () => {
    const division = result.divisionSummaries
      .find(({ countryTag }) => countryTag === 'USA')
      ?.divisions.find(({ divisionRef }) => divisionRef?.id === 1);

    expect(division).toMatchObject({
      supply: {
        current: 120,
        max: 108,
        gain: 0.15,
        outOfSupplyDays: 3,
        disrupted: 0.25,
      },
      supplyRatio: 120 / 108,
      fuel: 6.5,
      fuelRequested: 1.25,
      status: {
        strategicRedeployment: true,
        retreat: false,
        supportAttack: 6519,
      },
    });
  });

  test('preserves exact resolved and unresolved equipment entries', () => {
    const division = result.divisionSummaries.find(
      ({ countryTag }) => countryTag === 'D04',
    )?.divisions[0];

    expect(division?.equipment).toHaveLength(3);
    expect(division?.equipment[0]).toMatchObject({
      equipmentRef: { id: 20, type: 170 },
      amount: 0,
      equipment: {
        equipmentRef: { id: 20, type: 170 },
        definition: 'modded_tank.alpha',
        name: 'Variant Alpha',
        creatorTag: 'D04',
      },
    });
    expect(division?.equipment[2]).toEqual({
      equipmentRef: { id: 999, type: 70 },
      amount: 0.03846,
      equipment: null,
    });
  });

  test('links an army group, commander, army, and exact division references', () => {
    const usa = result.armyHierarchySummaries.find(
      ({ countryTag }) => countryTag === 'USA',
    );
    const group = usa?.armyGroups.find(
      ({ armyGroupRef }) => armyGroupRef?.id === 200,
    );
    const army = group?.armies[0];

    expect(group?.commander).toMatchObject({
      commanderRef: { id: 501, type: 54 },
      name: 'USA_field_marshal',
      role: 'field_marshal',
      skill: 5,
      traits: ['offensive_doctrine'],
    });
    expect(army).toMatchObject({
      armyRef: { id: 100, type: 53 },
      name: 'Army 1',
      commander: {
        commanderRef: { id: 500, type: 54 },
        name: 'USA_general',
        role: 'corps_commander',
      },
    });
    expect(army?.divisions).toEqual([
      { countryTag: 'USA', divisionRef: { id: 1, type: 51 } },
      { countryTag: 'USA', divisionRef: { id: 2, type: 4713 } },
    ]);
  });

  test('preserves groupless and uncommanded armies and groups', () => {
    const usa = result.armyHierarchySummaries.find(
      ({ countryTag }) => countryTag === 'USA',
    );
    const d04 = result.armyHierarchySummaries.find(
      ({ countryTag }) => countryTag === 'D04',
    );

    expect(
      usa?.armyGroups.find(({ armyGroupRef }) => armyGroupRef?.id === 201)
        ?.commander,
    ).toBeNull();
    expect(
      usa?.grouplessArmies.find(({ armyRef }) => armyRef?.id === 101)
        ?.commander,
    ).toBeNull();
    expect(d04?.grouplessArmies).toEqual([
      expect.objectContaining({
        armyRef: { id: 300, type: 53 },
        name: 'Groupless Army',
        commander: null,
      }),
    ]);
  });

  test('keeps genuinely unassigned dynamic-tag and expeditionary divisions', () => {
    const d04 = result.armyHierarchySummaries.find(
      ({ countryTag }) => countryTag === 'D04',
    );

    expect(d04?.linkedDivisionCount).toBe(0);
    expect(d04?.unassignedDivisionCount).toBe(1);
    expect(d04?.unassignedDivisions).toEqual([
      { countryTag: 'D04', divisionRef: { id: 3, type: 4713 } },
    ]);
    expect(
      result.divisionSummaries.find(({ countryTag }) => countryTag === 'D04')
        ?.divisions[0].expeditionaryOwnerTag,
    ).toBe('RKN');
  });

  test('retains unresolved memberships and partial records without throwing', () => {
    const usa = result.armyHierarchySummaries.find(
      ({ countryTag }) => countryTag === 'USA',
    );
    const unresolved = usa?.grouplessArmies.find(
      ({ armyRef }) => armyRef?.id === 101,
    );
    const partial = usa?.grouplessArmies.find(
      ({ name }) => name === 'Partial Army',
    );

    expect(unresolved?.unresolvedDivisionRefs).toEqual([{ id: 999, type: 51 }]);
    expect(unresolved?.complete).toBe(false);
    expect(partial).toMatchObject({ armyRef: null, complete: false });
  });

  test('keeps existing Stockpile and Production result fields', () => {
    expect(result.stockpileSummaries).toEqual([]);
    expect(result.militaryProductionSummaries).toEqual([]);
  });

  test('does not expose parser offsets, warnings, indexes, or registries', () => {
    const publicData = JSON.stringify({
      divisionSummaries: result.divisionSummaries,
      armyHierarchySummaries: result.armyHierarchySummaries,
    });

    expect(publicData).not.toContain('sourceOffset');
    expect(publicData).not.toContain('warnings');
    expect(publicData).not.toContain('topLevelBlocks');
    expect(publicData).not.toContain('duplicateReferences');
    expect(publicData).not.toContain('equipmentRegistry');
  });

  test('hierarchy references resolve exactly to public divisions', () => {
    const keys = new Set(
      result.divisionSummaries.flatMap(({ divisions }) =>
        divisions.flatMap(({ divisionRef }) =>
          divisionRef === null ? [] : [`${divisionRef.type}:${divisionRef.id}`],
        ),
      ),
    );
    const linked = result.armyHierarchySummaries.flatMap((country) => [
      ...country.armyGroups.flatMap(({ armies }) =>
        armies.flatMap(({ divisions }) => divisions),
      ),
      ...country.grouplessArmies.flatMap(({ divisions }) => divisions),
    ]);

    expect(linked).toHaveLength(2);
    for (const { divisionRef } of linked) {
      expect(divisionRef).not.toBeNull();
      expect(keys.has(`${divisionRef?.type}:${divisionRef?.id}`)).toBe(true);
    }
  });

  test('produces deterministic public division and hierarchy output', () => {
    const repeat = analyzeSave(populatedPath);

    expect(repeat.divisionSummaries).toEqual(result.divisionSummaries);
    expect(repeat.armyHierarchySummaries).toEqual(
      result.armyHierarchySummaries,
    );
  });
});
