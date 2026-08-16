import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DIVISION_TEMPLATE_FIXTURE } from './division/fixtures/division-template.fixture';
import { DIVISION_FIXTURE } from './division/fixtures/division.fixture';
import { analyzeSave, type AnalyzeResult } from './hoi4-parser';

const INTEGRATION_HIERARCHY_FIXTURE = `
equipments={
  duplicate_service_rifle={
    id={ id=11 type=70 }
    name="Service Rifle"
    creator="USA"
    origin="---"
  }
}
countries={
  USA={
    units={
      division={
        id={ id=4 type=51 }
        logical_country="USA"
        id={ id=4 type=51 }
        division_template_id={ id=100 type=52 }
        division_name={ type=0 override="Shared Template Division" }
        location=4201
        max_supply=108
        organisation=22
        strength=101
        equipment={
          equipment={ id={ id=10 type=70 } amount=10 }
          equipment={ id={ id=11 type=70 } amount=1.5 }
        }
        army_manpower={
          army_manpower_value={ value={ tag="USA" value=1000 } }
          army_manpower_need={ value={ tag="USA" value=1200 } }
        }
        experience=50
        army_current_supply_ratio=100
        supply_gain=0.1
      }
    }
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

  test('returns non-optional empty division data and hierarchy summaries', () => {
    const empty = analyzeSave(emptyPath);

    expect(empty.divisionSummaries).toEqual([]);
    expect(empty.divisionTemplateCatalog).toEqual([]);
    expect(empty.divisionEquipmentCatalog).toEqual([]);
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
    expect(division).not.toHaveProperty('template');
    const template = result.divisionTemplateCatalog.find(
      ({ templateRef }) => templateRef.id === 100 && templateRef.type === 52,
    );
    expect(template).toMatchObject({
      templateRef: { id: 100, type: 52 },
      name: 'Duplicate Name',
      role: 'infantry',
      countryTag: 'GER',
      originalTag: 'GER',
      foreignTemplateTag: '---',
      obsolete: false,
    });
    expect(template?.regiments).toHaveLength(3);
    expect(template?.supportCompanies).toHaveLength(2);
    expect(template?.regimentalSupport).toHaveLength(1);

    const obsoleteTemplate = result.divisionTemplateCatalog.find(
      ({ templateRef }) => templateRef.id === 101,
    );
    expect(obsoleteTemplate).toMatchObject({
      obsolete: true,
      obsoleteChangeDate: '1944.5.1.24',
    });
  });

  test('deduplicates shared templates and keeps duplicate names distinct by ref', () => {
    const usa = result.divisionSummaries.find(
      ({ countryTag }) => countryTag === 'USA',
    );
    const sharedTemplateDivisions = usa?.divisions.filter(
      ({ divisionTemplateRef }) =>
        divisionTemplateRef?.id === 100 && divisionTemplateRef.type === 52,
    );
    const duplicateNameTemplates = result.divisionTemplateCatalog.filter(
      ({ name }) => name === 'Duplicate Name',
    );

    expect(sharedTemplateDivisions).toHaveLength(2);
    expect(
      result.divisionTemplateCatalog.filter(
        ({ templateRef }) => templateRef.id === 100 && templateRef.type === 52,
      ),
    ).toHaveLength(1);
    expect(
      duplicateNameTemplates.map(({ templateRef }) => templateRef),
    ).toEqual([
      { id: 100, type: 52 },
      { id: 101, type: 52 },
    ]);
  });

  test('preserves an unresolved template ref without fabricating metadata', () => {
    const division = result.divisionSummaries.find(
      ({ countryTag }) => countryTag === 'D04',
    )?.divisions[0];

    expect(division?.divisionTemplateRef).toEqual({ id: 102, type: 52 });
    expect(
      result.divisionTemplateCatalog.some(
        ({ templateRef }) => templateRef.id === 102 && templateRef.type === 52,
      ),
    ).toBe(false);
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

  test('preserves exact resolved and unresolved equipment occurrences', () => {
    const division = result.divisionSummaries.find(
      ({ countryTag }) => countryTag === 'D04',
    )?.divisions[0];

    expect(division?.equipment).toHaveLength(3);
    expect(division?.equipment[0]).toEqual({
      equipmentRef: { id: 20, type: 170 },
      amount: 0,
    });
    expect(division?.equipment[2]).toEqual({
      equipmentRef: { id: 999, type: 70 },
      amount: 0.03846,
    });
    expect(division?.equipment.map(({ amount }) => amount)).toEqual([
      0, -2.5, 0.03846,
    ]);
    expect(
      result.divisionEquipmentCatalog.find(
        ({ equipmentRef }) =>
          equipmentRef.id === 20 && equipmentRef.type === 170,
      ),
    ).toMatchObject({
      definition: 'modded_tank.alpha',
      name: 'Variant Alpha',
      creatorTag: 'D04',
    });
    expect(
      result.divisionEquipmentCatalog.some(
        ({ equipmentRef }) =>
          equipmentRef.id === 999 && equipmentRef.type === 70,
      ),
    ).toBe(false);
  });

  test('deduplicates equipment metadata and keeps identical names distinct by ref', () => {
    const occurrences = result.divisionSummaries.flatMap(({ divisions }) =>
      divisions.flatMap(({ equipment }) => equipment),
    );
    const serviceRifles = result.divisionEquipmentCatalog.filter(
      ({ name }) => name === 'Service Rifle',
    );

    expect(
      occurrences.filter(
        ({ equipmentRef }) =>
          equipmentRef?.id === 10 && equipmentRef.type === 70,
      ).length,
    ).toBeGreaterThan(1);
    expect(
      result.divisionEquipmentCatalog.filter(
        ({ equipmentRef }) =>
          equipmentRef.id === 10 && equipmentRef.type === 70,
      ),
    ).toHaveLength(1);
    expect(serviceRifles.map(({ equipmentRef }) => equipmentRef)).toEqual([
      { id: 10, type: 70 },
      { id: 11, type: 70 },
    ]);
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
      divisionTemplateCatalog: result.divisionTemplateCatalog,
      divisionEquipmentCatalog: result.divisionEquipmentCatalog,
      armyHierarchySummaries: result.armyHierarchySummaries,
    });

    expect(publicData).not.toContain('sourceOffset');
    expect(publicData).not.toContain('warnings');
    expect(publicData).not.toContain('topLevelBlocks');
    expect(publicData).not.toContain('duplicateReferences');
    expect(publicData).not.toContain('equipmentRegistry');
  });

  test('all resolved division references reconstruct through the catalogs', () => {
    const templateKeys = new Set(
      result.divisionTemplateCatalog.map(
        ({ templateRef }) => `${templateRef.type}:${templateRef.id}`,
      ),
    );
    const equipmentKeys = new Set(
      result.divisionEquipmentCatalog.map(
        ({ equipmentRef }) => `${equipmentRef.type}:${equipmentRef.id}`,
      ),
    );
    const divisions = result.divisionSummaries.flatMap(
      ({ divisions }) => divisions,
    );

    for (const division of divisions.filter(
      ({ divisionTemplateRef }) => divisionTemplateRef?.id !== 102,
    )) {
      expect(
        templateKeys.has(
          `${division.divisionTemplateRef?.type}:${division.divisionTemplateRef?.id}`,
        ),
      ).toBe(true);
    }
    for (const occurrence of divisions.flatMap(({ equipment }) => equipment)) {
      const key = `${occurrence.equipmentRef?.type}:${occurrence.equipmentRef?.id}`;
      expect(equipmentKeys.has(key)).toBe(occurrence.equipmentRef?.id !== 999);
    }
  });

  test('sorts catalogs deterministically by ref type and id', () => {
    expect(
      result.divisionTemplateCatalog.map(({ templateRef }) => templateRef),
    ).toEqual([
      { id: 100, type: 52 },
      { id: 101, type: 52 },
    ]);
    expect(
      result.divisionEquipmentCatalog.map(({ equipmentRef }) => equipmentRef),
    ).toEqual([
      { id: 10, type: 70 },
      { id: 11, type: 70 },
      { id: 20, type: 170 },
    ]);
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
    expect(repeat.divisionTemplateCatalog).toEqual(
      result.divisionTemplateCatalog,
    );
    expect(repeat.divisionEquipmentCatalog).toEqual(
      result.divisionEquipmentCatalog,
    );
    expect(repeat.armyHierarchySummaries).toEqual(
      result.armyHierarchySummaries,
    );
  });
});
