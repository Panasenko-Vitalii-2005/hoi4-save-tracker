import {
  COMPLETE_SUNK_SHIP,
  sunkShipWith,
  topLevelHistory,
} from './fixtures/global-history.fixture';
import {
  assistedSunkShip,
  historyQueue,
  shipHistoryFixture,
} from './fixtures/ship-history.fixture';
import { parseShipHistoryNavalLosses } from './ship-history.parser';

describe('parseShipHistoryNavalLosses', () => {
  test('parses a normal credited-killer copy without inferring its role', () => {
    const { records } = parseShipHistoryNavalLosses(shipHistoryFixture());

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      source: 'ship_history',
      ordinal: 0,
      complete: true,
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
    });
  });

  test('preserves assist=yes', () => {
    const assisted = assistedSunkShip();
    const { records } = parseShipHistoryNavalLosses(
      shipHistoryFixture({
        ships: [{ entries: [historyQueue(assisted)] }],
      }),
    );

    expect(records[0].attribution.assist).toBe(true);
  });

  test('preserves a missing assist field as null', () => {
    const { records } = parseShipHistoryNavalLosses(shipHistoryFixture());
    expect(records[0].attribution.assist).toBeNull();
  });

  test('keeps multiple assistants for one loss as separate raw records', () => {
    const assisted = assistedSunkShip();
    const { records, parentContexts } = parseShipHistoryNavalLosses(
      shipHistoryFixture({
        ships: [
          {
            id: '{ id=31 type=51 }',
            name: 'Assistant One',
            entries: [historyQueue(assisted)],
          },
          {
            id: '{ id=32 type=51 }',
            name: 'Assistant Two',
            entries: [historyQueue(assisted)],
          },
        ],
      }),
    );

    expect(records).toHaveLength(2);
    expect(records.every((record) => record.attribution.assist)).toBe(true);
    expect(new Set(records.map((record) => record.recordId)).size).toBe(2);
    expect(parentContexts).toHaveLength(2);
  });

  test('captures the parent country tag', () => {
    const result = parseShipHistoryNavalLosses(
      shipHistoryFixture({ countryTag: 'USA' }),
    );
    expect(result.parentContexts[0].countryTag).toBe('USA');
  });

  test('captures the parent fleet ID', () => {
    const result = parseShipHistoryNavalLosses(
      shipHistoryFixture({ fleetId: '{ id=101 type=61 }' }),
    );
    expect(result.parentContexts[0].fleetId).toEqual({
      id: 101,
      type: 61,
      status: 'valid',
    });
  });

  test('captures the parent task-force ID', () => {
    const result = parseShipHistoryNavalLosses(
      shipHistoryFixture({ taskForceId: '{ id=202 type=61 }' }),
    );
    expect(result.parentContexts[0].taskForceId).toEqual({
      id: 202,
      type: 61,
      status: 'valid',
    });
  });

  test('captures the parent ship ID', () => {
    const result = parseShipHistoryNavalLosses(
      shipHistoryFixture({ ships: [{ id: '{ id=303 type=51 }' }] }),
    );
    expect(result.parentContexts[0].shipId).toEqual({
      id: 303,
      type: 51,
      status: 'valid',
    });
  });

  test('preserves zero-sentinel parent IDs', () => {
    const result = parseShipHistoryNavalLosses(
      shipHistoryFixture({ fleetId: '{ id=0 type=0 }' }),
    );
    expect(result.parentContexts[0].fleetId).toEqual({
      id: 0,
      type: 0,
      status: 'zero_sentinel',
    });
  });

  test('captures the parent ship definition', () => {
    const result = parseShipHistoryNavalLosses(
      shipHistoryFixture({ ships: [{ definition: 'modded_raider' }] }),
    );
    expect(result.parentContexts[0].shipDefinition).toBe('modded_raider');
  });

  test('captures the parent ship name when available', () => {
    const result = parseShipHistoryNavalLosses(
      shipHistoryFixture({ ships: [{ name: 'HMS Example' }] }),
    );
    expect(result.parentContexts[0].shipName).toBe('HMS Example');
  });

  test('handles missing parent IDs without crashing', () => {
    const result = parseShipHistoryNavalLosses(
      shipHistoryFixture({
        fleetId: null,
        taskForceId: null,
        ships: [{ id: null }],
      }),
    );

    expect(result.parentContexts[0]).toMatchObject({
      fleetId: null,
      taskForceId: null,
      shipId: null,
    });
    expect(result.records[0].complete).toBe(false);
    expect(result.records[0].warnings).toEqual(
      expect.arrayContaining([
        'missing parent fleet id',
        'missing parent task-force id',
        'missing parent ship id',
      ]),
    );
  });

  test('ignores the dummy history_queue wrapper date', () => {
    const result = parseShipHistoryNavalLosses(
      shipHistoryFixture({
        ships: [{ entries: [historyQueue(COMPLETE_SUNK_SHIP, '1.1.1.1')] }],
      }),
    );
    expect(result.records[0].event.date).not.toBe('1.1.1.1');
  });

  test('uses the inner sunk_ship date', () => {
    const loss = sunkShipWith({ date: '"1944.5.6.7"' });
    const result = parseShipHistoryNavalLosses(
      shipHistoryFixture({
        ships: [{ entries: [historyQueue(loss, '1.1.1.1')] }],
      }),
    );
    expect(result.records[0].event.date).toBe('1944.5.6.7');
  });

  test('ignores top-level history.sunk_ship', () => {
    const result = parseShipHistoryNavalLosses(
      topLevelHistory(COMPLETE_SUNK_SHIP),
    );
    expect(result).toEqual({ records: [], parentContexts: [] });
  });

  test('ignores unrelated history_queue blocks', () => {
    const text = `${shipHistoryFixture({ ships: [{ entries: [] }] })}
      history_queue={ ${COMPLETE_SUNK_SHIP} }
      countries_extra={ history_queue={ ${COMPLETE_SUNK_SHIP} } }`;
    const result = parseShipHistoryNavalLosses(text);
    expect(result.records).toEqual([]);
  });

  test('returns a partial record with warnings for a malformed nested block', () => {
    const result = parseShipHistoryNavalLosses(
      'countries={ ENG={ fleet={ task_force={ ship={ history={ army_history={ history_queue={ sunk_ship={ name="Broken"',
    );

    expect(result.records[0].sunkShip.name).toBe('Broken');
    expect(result.records[0].complete).toBe(false);
    expect(result.records[0].warnings).toContain(
      'unterminated sunk_ship block',
    );
  });

  test('preserves conflicting killer and parent country tags', () => {
    const loss = sunkShipWith({ killer_country: '"ENG"' });
    const result = parseShipHistoryNavalLosses(
      shipHistoryFixture({
        countryTag: 'USA',
        ships: [{ entries: [historyQueue(loss)] }],
      }),
    );

    expect(result.records[0].attribution.killerCountryTag).toBe('ENG');
    expect(result.parentContexts[0].countryTag).toBe('USA');
  });

  test('preserves source order across ships and queues', () => {
    const first = sunkShipWith({ name: '"First"' });
    const second = sunkShipWith({ name: '"Second"' });
    const third = sunkShipWith({ name: '"Third"' });
    const result = parseShipHistoryNavalLosses(
      shipHistoryFixture({
        ships: [
          {
            id: '{ id=1 type=51 }',
            entries: [historyQueue(first), historyQueue(second)],
          },
          { id: '{ id=2 type=51 }', entries: [historyQueue(third)] },
        ],
      }),
    );

    expect(result.records.map((record) => record.sunkShip.name)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
    expect(result.records.map((record) => record.ordinal)).toEqual([0, 1, 2]);
  });

  test('keeps identical ship-history occurrences separate', () => {
    const result = parseShipHistoryNavalLosses(
      shipHistoryFixture({
        ships: [
          {
            entries: [
              historyQueue(COMPLETE_SUNK_SHIP),
              historyQueue(COMPLETE_SUNK_SHIP),
            ],
          },
        ],
      }),
    );

    expect(result.records).toHaveLength(2);
    expect(result.records[0].recordId).not.toBe(result.records[1].recordId);
    expect(result.records[0].sunkShip).toEqual(result.records[1].sunkShip);
  });

  test('parses the units wrapper used by real country save data', () => {
    const result = parseShipHistoryNavalLosses(
      shipHistoryFixture({ unitsWrapper: true }),
    );

    expect(result.records).toHaveLength(1);
    expect(result.records[0].sourcePath).toBe(
      'countries.TAG.units.fleet.task_force.ship.history.army_history.history_queue.sunk_ship',
    );
  });
});
