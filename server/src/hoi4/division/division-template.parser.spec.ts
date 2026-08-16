import { findDirectBlocks } from '../naval-loss/global-history.parser';
import {
  DIVISION_TEMPLATE_FIXTURE,
  DIVISION_TEMPLATE_SCOPE_FIXTURE,
  DUPLICATE_TEMPLATE_REFERENCE_FIXTURE,
  MALFORMED_DIVISION_TEMPLATE_FIXTURE,
} from './fixtures/division-template.fixture';
import { parseDivisionTemplates } from './division-template.parser';

describe('parseDivisionTemplates', () => {
  test('parses canonical global division template records', () => {
    expect(parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)).toHaveLength(3);
  });

  test('preserves template source order and absolute offsets', () => {
    const records = parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE);

    expect(records.map(({ templateRef }) => templateRef?.id)).toEqual([
      100, 101, 7,
    ]);
    expect(records.map(({ sourceOffset }) => sourceOffset)).toEqual(
      [...records.map(({ sourceOffset }) => sourceOffset)].sort(
        (left, right) => left - right,
      ),
    );
  });

  test('preserves the full save-scoped id and type pair', () => {
    expect(
      parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[0].templateRef,
    ).toEqual({ id: 100, type: 52 });
  });

  test('accepts arbitrary numeric template reference types', () => {
    expect(
      parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[2].templateRef,
    ).toEqual({ id: 7, type: 170 });
  });

  test('captures the exact raw template name', () => {
    expect(parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[0].name).toBe(
      'Duplicate Name',
    );
  });

  test('keeps duplicate names as records with different identities', () => {
    const [first, second] = parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE);

    expect(first.name).toBe(second.name);
    expect(first.templateRef).not.toEqual(second.templateRef);
  });

  test('preserves a blank template name', () => {
    expect(parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[2].name).toBe('');
  });

  test('accepts a missing template name as null', () => {
    const fixture = `division_templates={
      division_template={ id={ id=8 type=52 } country="USA" }
    }`;
    const record = parseDivisionTemplates(fixture)[0];

    expect(record.name).toBeNull();
    expect(record.complete).toBe(true);
    expect(record.warnings).toEqual([]);
  });

  test('captures the template country tag', () => {
    expect(
      parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[0].countryTag,
    ).toBe('GER');
  });

  test('preserves dynamic country tags without normalization', () => {
    expect(
      parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[2].countryTag,
    ).toBe('D04');
  });

  test('captures original tag independently', () => {
    expect(
      parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[1].originalTag,
    ).toBe('ENG');
  });

  test('captures foreign template tag independently', () => {
    expect(
      parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[1].foreignTemplateTag,
    ).toBe('GER');
  });

  test('accepts missing optional metadata without warnings', () => {
    const record = parseDivisionTemplates(
      MALFORMED_DIVISION_TEMPLATE_FIXTURE,
    )[1];

    expect(record).toMatchObject({
      originalTag: null,
      foreignTemplateTag: null,
      role: null,
      obsolete: false,
      obsoleteDate: null,
      complete: true,
      warnings: [],
    });
  });

  test('captures role as a raw string', () => {
    expect(parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[0].role).toBe(
      'infantry',
    );
  });

  test('preserves arbitrary custom roles verbatim', () => {
    expect(parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[2].role).toBe(
      'rangers_role',
    );
  });

  test('keeps a missing role as null', () => {
    expect(
      parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[1].role,
    ).toBeNull();
  });

  test('captures obsolete=yes and defaults absent obsolete to false', () => {
    const records = parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE);

    expect(records[1].obsolete).toBe(true);
    expect(records[0].obsolete).toBe(false);
  });

  test('does not discard obsolete templates', () => {
    const records = parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE);

    expect(records).toContainEqual(expect.objectContaining({ obsolete: true }));
  });

  test('preserves the raw obsolete change date including hour 24', () => {
    expect(
      parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[1].obsoleteDate,
    ).toBe('1944.5.1.24');
  });

  test('parses multiple regiment slots in source order', () => {
    expect(
      parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[0].regiments.map(
        ({ unitType }) => unitType,
      ),
    ).toEqual(['infantry', 'infantry', 'artillery_brigade']);
  });

  test('preserves repeated battalion types as separate slots', () => {
    const infantry = parseDivisionTemplates(
      DIVISION_TEMPLATE_FIXTURE,
    )[0].regiments.filter(({ unitType }) => unitType === 'infantry');

    expect(infantry).toHaveLength(2);
    expect(infantry.map(({ y }) => y)).toEqual([0, 1]);
  });

  test('captures regiment x and y coordinates exactly', () => {
    expect(
      parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[0].regiments[2],
    ).toMatchObject({ unitType: 'artillery_brigade', x: 1, y: 0 });
  });

  test('parses support companies separately from regiments', () => {
    const record = parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[0];

    expect(record.supportCompanies.map(({ unitType }) => unitType)).toEqual([
      'engineer',
      'mod_support.alpha',
    ]);
    expect(record.regiments.map(({ unitType }) => unitType)).not.toContain(
      'engineer',
    );
  });

  test('captures support x and y coordinates exactly', () => {
    expect(
      parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[0].supportCompanies[1],
    ).toMatchObject({ unitType: 'mod_support.alpha', x: 0, y: 1 });
  });

  test('preserves arbitrary custom battalion identifiers', () => {
    expect(
      parseDivisionTemplates(MALFORMED_DIVISION_TEMPLATE_FIXTURE)[0].regiments,
    ).toContainEqual(expect.objectContaining({ unitType: 'penal_battalion' }));
  });

  test('preserves arbitrary custom support identifiers', () => {
    expect(
      parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[0].supportCompanies,
    ).toContainEqual(
      expect.objectContaining({ unitType: 'mod_support.alpha' }),
    );
  });

  test('preserves the real regimental_support sibling separately', () => {
    const record = parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[0];

    expect(record.regimentalSupport).toEqual([
      expect.objectContaining({ unitType: 'fire_support', x: 0, y: 0 }),
    ]);
    expect(
      record.supportCompanies.map(({ unitType }) => unitType),
    ).not.toContain('fire_support');
  });

  test('returns an empty regiment array when the block is absent', () => {
    expect(
      parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[2].regiments,
    ).toEqual([]);
  });

  test('returns an empty support array when the block is absent', () => {
    expect(
      parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[1].supportCompanies,
    ).toEqual([]);
  });

  test('keeps malformed slots as warned partial records and parses later slots', () => {
    const record = parseDivisionTemplates(
      MALFORMED_DIVISION_TEMPLATE_FIXTURE,
    )[0];

    expect(record.regiments).toHaveLength(2);
    expect(record.regiments[0]).toMatchObject({
      unitType: 'penal_battalion',
      x: null,
      y: null,
    });
    expect(record.regiments[0].warnings).toEqual([
      'invalid x: broken',
      'invalid y: also_broken',
    ]);
    expect(record.regiments[1]).toMatchObject({ unitType: 'bus', x: 1, y: 2 });
    expect(record.supportCompanies.at(-1)).toMatchObject({
      unitType: 'valid_support',
      x: 0,
      y: 1,
    });
  });

  test('returns nulls and warnings for malformed core fields', () => {
    const record = parseDivisionTemplates(
      MALFORMED_DIVISION_TEMPLATE_FIXTURE,
    )[0];

    expect(record).toMatchObject({
      templateRef: null,
      countryTag: null,
      obsolete: false,
      obsoleteDate: null,
      complete: false,
    });
    expect(record.warnings).toEqual(
      expect.arrayContaining([
        'invalid id.id: broken',
        'missing country',
        'invalid obsolete: perhaps',
        'invalid obsolete_change_date: not-a-date',
      ]),
    );
  });

  test('continues parsing valid templates after a malformed template', () => {
    const records = parseDivisionTemplates(MALFORMED_DIVISION_TEMPLATE_FIXTURE);

    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({
      templateRef: { id: 202, type: 52 },
      name: 'Valid Later Template',
      countryTag: 'USA',
      complete: true,
      warnings: [],
    });
  });

  test('does not silently deduplicate duplicate template references', () => {
    const records = parseDivisionTemplates(
      DUPLICATE_TEMPLATE_REFERENCE_FIXTURE,
    );

    expect(records).toHaveLength(2);
    expect(records.map(({ name }) => name)).toEqual(['First', 'Second']);
    expect(records[1].warnings).toContain('duplicate template reference: 52:9');
  });

  test('ignores nested and unrelated division_template lookalikes', () => {
    const records = parseDivisionTemplates(DIVISION_TEMPLATE_SCOPE_FIXTURE);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      templateRef: { id: 5, type: 52 },
      name: 'Canonical',
    });
  });

  test('does not expose calculated combat statistics', () => {
    const record = parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[0];

    for (const field of [
      'manpowerRequirement',
      'equipmentRequirement',
      'combatWidth',
      'maximumOrganization',
      'softAttack',
      'hardAttack',
      'defense',
      'breakthrough',
      'armor',
      'piercing',
      'speed',
      'supplyUse',
      'fuelUse',
    ]) {
      expect(record).not.toHaveProperty(field);
    }
  });

  test('does not derive a division type classification', () => {
    const record = parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)[0];

    expect(record).not.toHaveProperty('divisionType');
    expect(record).not.toHaveProperty('dominantType');
  });

  test('accepts and reuses an existing top-level block index', () => {
    const topLevelBlocks = findDirectBlocks(
      DIVISION_TEMPLATE_FIXTURE,
      0,
      DIVISION_TEMPLATE_FIXTURE.length,
    );

    expect(
      parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE, topLevelBlocks),
    ).toHaveLength(3);
  });

  test('does not mutate the input text or supplied block index', () => {
    const originalText = DIVISION_TEMPLATE_FIXTURE;
    const topLevelBlocks = findDirectBlocks(
      originalText,
      0,
      originalText.length,
    );
    const blocksBefore = JSON.stringify(topLevelBlocks);

    parseDivisionTemplates(originalText, topLevelBlocks);

    expect(originalText).toBe(DIVISION_TEMPLATE_FIXTURE);
    expect(JSON.stringify(topLevelBlocks)).toBe(blocksBefore);
  });

  test('returns deterministic records for identical inputs', () => {
    expect(parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE)).toEqual(
      parseDivisionTemplates(DIVISION_TEMPLATE_FIXTURE),
    );
  });
});
