import {
  COMPLETE_SUNK_SHIP,
  sunkShipWith,
  topLevelHistory,
} from './fixtures/global-history.fixture';
import {
  findDirectBlocks,
  parseGlobalNavalLossHistory,
  readDirectScalar,
  readDirectScalars,
} from './global-history.parser';

describe('readDirectScalars', () => {
  test('indexes direct quoted, unquoted, and empty scalar values in one pass', () => {
    const body = 'name="Hawaiian Division" strength=87.5 empty=""';
    const scalars = readDirectScalars(body, 0, body.length);

    expect([...scalars]).toEqual([
      ['name', 'Hawaiian Division'],
      ['strength', '87.5'],
      ['empty', ''],
    ]);
  });

  test('ignores nested fields and identifier-like text inside quoted strings', () => {
    const body =
      'direct=yes nested={ direct=no nested_only=1 } note="fake=value { direct=no }"';
    const scalars = readDirectScalars(body, 0, body.length);

    expect(scalars.get('direct')).toBe('yes');
    expect(scalars.get('note')).toBe('fake=value { direct=no }');
    expect(scalars.has('nested_only')).toBe(false);
    expect(scalars.has('fake')).toBe(false);
  });

  test('preserves readDirectScalar first-occurrence semantics', () => {
    const body = 'value=first value=second nested={ value=third }';
    const scalars = readDirectScalars(body, 0, body.length);

    expect(scalars.get('value')).toBe('first');
    expect(scalars.get('value')).toBe(
      readDirectScalar(body, 0, body.length, 'value'),
    );
  });
});

describe('parseGlobalNavalLossHistory with precomputed top-level blocks', () => {
  const parseIndexed = (text: string) =>
    parseGlobalNavalLossHistory(text, findDirectBlocks(text, 0, text.length));

  test('matches every raw field from the standalone fallback', () => {
    const text = topLevelHistory(COMPLETE_SUNK_SHIP);
    const records = parseIndexed(text);

    expect(records).toHaveLength(1);
    expect(records).toEqual(parseGlobalNavalLossHistory(text));
    expect(records[0].complete).toBe(true);
  });

  test('preserves source order across multiple direct history blocks', () => {
    const text = [
      topLevelHistory(sunkShipWith({ name: '"First"' })),
      'unrelated={ value=1 }',
      topLevelHistory(),
      topLevelHistory(
        sunkShipWith({ name: '"Second"' }),
        sunkShipWith({ name: '"Third"' }),
      ),
    ].join('\n');
    const records = parseIndexed(text);

    expect(records).toEqual(parseGlobalNavalLossHistory(text));
    expect(records.map(({ sunkShip }) => sunkShip.name)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
    expect(records.map(({ ordinal }) => ordinal)).toEqual([0, 1, 2]);
    expect(records[0].sourceOffset).toBeLessThan(records[1].sourceOffset);
    expect(records[1].sourceOffset).toBeLessThan(records[2].sourceOffset);
  });

  test('excludes nested history lookalikes and nested sunk_ship entries', () => {
    const text = `wrapper={ ${topLevelHistory(COMPLETE_SUNK_SHIP)} }
      country_history={ ${COMPLETE_SUNK_SHIP} }
      history={
        nested={ ${COMPLETE_SUNK_SHIP} }
        ${sunkShipWith({ name: '"Direct only"' })}
      }`;
    const records = parseIndexed(text);

    expect(records).toEqual(parseGlobalNavalLossHistory(text));
    expect(records.map(({ sunkShip }) => sunkShip.name)).toEqual([
      'Direct only',
    ]);
  });

  test.each([
    ['empty save', ''],
    [
      'only nested history',
      `wrapper={ ${topLevelHistory(COMPLETE_SUNK_SHIP)} }`,
    ],
    ['empty history', topLevelHistory()],
  ])('returns no events for %s', (_, text) => {
    expect(parseIndexed(text)).toEqual([]);
    expect(parseIndexed(text)).toEqual(parseGlobalNavalLossHistory(text));
  });

  test.each([
    {
      name: 'malformed field',
      text: topLevelHistory(sunkShipWith({ level: 'bad' })),
      complete: false,
      warnings: ['invalid level: bad'],
    },
    {
      name: 'unterminated sunk_ship and history',
      text: `history={${COMPLETE_SUNK_SHIP.slice(0, -1)}`,
      complete: false,
      warnings: ['unterminated sunk_ship block'],
    },
    {
      name: 'complete event inside unterminated history',
      text: `history={${COMPLETE_SUNK_SHIP}`,
      complete: true,
      warnings: [],
    },
  ])('preserves legacy $name semantics', ({ text, complete, warnings }) => {
    const records = parseIndexed(text);
    expect(records).toEqual(parseGlobalNavalLossHistory(text));
    expect(records).toHaveLength(1);
    expect(records[0].complete).toBe(complete);
    expect(records[0].warnings).toEqual(warnings);
  });

  test('does not mutate the supplied array or its LocatedBlock objects', () => {
    const text = `${topLevelHistory(COMPLETE_SUNK_SHIP)}
      unrelated={ value=1 }
      ${topLevelHistory(sunkShipWith({ name: '"Second"' }))}`;
    const blocks = Object.freeze(
      findDirectBlocks(text, 0, text.length)
        .reverse()
        .map((block) => Object.freeze(block)),
    );
    const before = JSON.stringify(blocks);

    expect(parseGlobalNavalLossHistory(text, blocks)).toEqual(
      parseGlobalNavalLossHistory(text),
    );
    expect(JSON.stringify(blocks)).toBe(before);
  });

  test('preserves identical occurrences within and across history blocks', () => {
    const text = `${topLevelHistory(COMPLETE_SUNK_SHIP, COMPLETE_SUNK_SHIP)}
      ${topLevelHistory(COMPLETE_SUNK_SHIP)}`;
    const records = parseIndexed(text);

    expect(records).toEqual(parseGlobalNavalLossHistory(text));
    expect(records).toHaveLength(3);
    expect(new Set(records.map(({ recordId }) => recordId)).size).toBe(3);
    expect(records.every(({ sunkShip }) => sunkShip.name === 'U-144')).toBe(
      true,
    );
  });

  test('preserves duplicate scalar keys, empty names, modded definitions and sentinels', () => {
    const text = topLevelHistory(
      sunkShipWith({
        name: '""\n  name="Ignored second name"',
        definition: 'modded_dreadnought',
        battle: '{ id=0 type=0 }',
      }),
    );
    const records = parseIndexed(text);

    expect(records).toEqual(parseGlobalNavalLossHistory(text));
    expect(records[0].sunkShip.name).toBe('');
    expect(records[0].sunkShip.definition).toBe('modded_dreadnought');
    expect(records[0].event.battle).toEqual({
      id: 0,
      type: 0,
      status: 'zero_sentinel',
    });
  });

  test('treats a supplied empty index as authoritative without falling back', () => {
    const text = topLevelHistory(COMPLETE_SUNK_SHIP);
    expect(parseGlobalNavalLossHistory(text, [])).toEqual([]);
    expect(parseGlobalNavalLossHistory(text)).toHaveLength(1);
  });
});

describe('parseGlobalNavalLossHistory', () => {
  test('parses a complete normal event', () => {
    const [record] = parseGlobalNavalLossHistory(
      topLevelHistory(COMPLETE_SUNK_SHIP),
    );

    expect(record).toMatchObject({
      source: 'global_history',
      sourcePath: 'history.sunk_ship',
      ordinal: 0,
      complete: true,
      warnings: [],
      sunkShip: {
        name: 'U-144',
        countryTag: 'GER',
        definition: 'submarine',
        level: 3,
        equipmentVariant: { id: 6032, type: 70, status: 'valid' },
      },
      attribution: {
        killerName: 'HMS Napier',
        killerCountryTag: 'ENG',
        killerDefinition: 'destroyer',
        assist: null,
      },
      event: {
        date: '1943.9.28.21',
        location: 8522,
        battle: { id: 124995, type: 4713, status: 'valid' },
        convoyRelated: false,
      },
      parentContextId: null,
    });
    expect(record.recordId).toBe(`global_history:${record.sourceOffset}:0`);
  });

  test('preserves the order of multiple top-level events', () => {
    const first = sunkShipWith({ name: '"First"' });
    const second = sunkShipWith({ name: '"Second"' });
    const records = parseGlobalNavalLossHistory(topLevelHistory(first, second));

    expect(records.map((record) => record.sunkShip.name)).toEqual([
      'First',
      'Second',
    ]);
    expect(records[0].sourceOffset).toBeLessThan(records[1].sourceOffset);
    expect(records.map((record) => record.ordinal)).toEqual([0, 1]);
  });

  test('preserves an empty ship name as valid raw data', () => {
    const [record] = parseGlobalNavalLossHistory(
      topLevelHistory(sunkShipWith({ name: '""' })),
    );

    expect(record.sunkShip.name).toBe('');
    expect(record.complete).toBe(true);
  });

  test('preserves an unknown or modded ship definition', () => {
    const [record] = parseGlobalNavalLossHistory(
      topLevelHistory(sunkShipWith({ definition: 'mod_super_dreadnought' })),
    );

    expect(record.sunkShip.definition).toBe('mod_super_dreadnought');
    expect(record.complete).toBe(true);
  });

  test('preserves killer_definition=none', () => {
    const [record] = parseGlobalNavalLossHistory(
      topLevelHistory(sunkShipWith({ killer_definition: 'none' })),
    );

    expect(record.attribution.killerDefinition).toBe('none');
  });

  test('parses convoy=yes', () => {
    const [record] = parseGlobalNavalLossHistory(
      topLevelHistory(sunkShipWith({ convoy: 'yes' })),
    );

    expect(record.event.convoyRelated).toBe(true);
  });

  test('preserves a zero battle ID as a zero sentinel', () => {
    const [record] = parseGlobalNavalLossHistory(
      topLevelHistory(sunkShipWith({ battle: '{ id=0 type=0 }' })),
    );

    expect(record.event.battle).toEqual({
      id: 0,
      type: 0,
      status: 'zero_sentinel',
    });
    expect(record.complete).toBe(true);
  });

  test('does not infer an absent optional assist field', () => {
    const [record] = parseGlobalNavalLossHistory(
      topLevelHistory(COMPLETE_SUNK_SHIP),
    );

    expect(record.attribution.assist).toBeNull();
    expect(record.warnings).toEqual([]);
  });

  test('returns a partial record with warnings for a malformed field', () => {
    const [record] = parseGlobalNavalLossHistory(
      topLevelHistory(sunkShipWith({ level: 'not-a-number' })),
    );

    expect(record.sunkShip.level).toBeNull();
    expect(record.complete).toBe(false);
    expect(record.warnings).toContain('invalid level: not-a-number');
  });

  test('returns a partial record for an unterminated sunk_ship block', () => {
    const malformed = COMPLETE_SUNK_SHIP.slice(0, -1);
    const [record] = parseGlobalNavalLossHistory(`history={${malformed}`);

    expect(record.complete).toBe(false);
    expect(record.warnings).toContain('unterminated sunk_ship block');
  });

  test('keeps identical top-level occurrences as separate records', () => {
    const records = parseGlobalNavalLossHistory(
      topLevelHistory(COMPLETE_SUNK_SHIP, COMPLETE_SUNK_SHIP),
    );

    expect(records).toHaveLength(2);
    expect(records[0].recordId).not.toBe(records[1].recordId);
    expect(records[0].sunkShip).toEqual(records[1].sunkShip);
  });

  test('ignores sunk_ship blocks nested in ship histories', () => {
    const text = `countries={
      ENG={
        fleet={
          task_force={
            ship={
              history={ army_history={ history_queue={ ${COMPLETE_SUNK_SHIP} } } }
            }
          }
        }
      }
    }
    ${topLevelHistory(sunkShipWith({ name: '"Global only"' }))}`;

    const records = parseGlobalNavalLossHistory(text);
    expect(records.map((record) => record.sunkShip.name)).toEqual([
      'Global only',
    ]);
  });

  test('ignores unrelated and nested history blocks', () => {
    const text = `country_history={ ${COMPLETE_SUNK_SHIP} }
    wrapper={ history={ ${COMPLETE_SUNK_SHIP} } }
    history={ nested={ ${COMPLETE_SUNK_SHIP} } }
    ${topLevelHistory(sunkShipWith({ name: '"Direct child"' }))}`;

    const records = parseGlobalNavalLossHistory(text);
    expect(records.map((record) => record.sunkShip.name)).toEqual([
      'Direct child',
    ]);
  });
});
