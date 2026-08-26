import {
  COMPLETE_SUNK_SHIP,
  sunkShipWith,
  topLevelHistory,
} from './fixtures/global-history.fixture';
import {
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
