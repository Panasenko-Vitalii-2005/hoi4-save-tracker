import {
  navalLossParentContext,
  navalLossRecord,
  shipHistoryRecord,
} from './fixtures/deduplication.fixture';
import { deduplicateNavalLosses } from './naval-loss.deduplicator';
import type { ParsedNavalLoss, SaveScopedId } from './naval-loss.types';

const ZERO_ID: SaveScopedId = {
  id: 0,
  type: 0,
  status: 'zero_sentinel',
};

describe('deduplicateNavalLosses', () => {
  test('turns one global record into one global-anchor event', () => {
    const events = deduplicateNavalLosses([navalLossRecord()]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      rawRecordCount: 1,
      deduplicationStatus: 'global_anchor',
      sourceSummary: {
        hasGlobalHistoryRecord: true,
        hasShipHistoryRecord: false,
      },
    });
  });

  test('turns one ship-history record into one ship-history event', () => {
    const events = deduplicateNavalLosses([shipHistoryRecord()]);

    expect(events).toHaveLength(1);
    expect(events[0].deduplicationStatus).toBe('ship_history_only');
  });

  test('merges equivalent global and credited ship-history copies', () => {
    const events = deduplicateNavalLosses([
      navalLossRecord(),
      shipHistoryRecord(),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      rawRecordCount: 2,
      deduplicationStatus: 'matched_to_global',
    });
  });

  test('merges a global record, credited copy, and two assistants', () => {
    const records = [
      navalLossRecord(),
      shipHistoryRecord(),
      shipHistoryRecord({
        recordId: 'assistant-1',
        sourceOffset: 300,
        parentContextId: 'assistant-context-1',
        attribution: { assist: true, killerName: 'HMS Assistant One' },
      }),
      shipHistoryRecord({
        recordId: 'assistant-2',
        sourceOffset: 400,
        parentContextId: 'assistant-context-2',
        attribution: { assist: true, killerName: 'HMS Assistant Two' },
      }),
    ];

    const [event] = deduplicateNavalLosses(records);
    expect(event.rawRecordCount).toBe(4);
    expect(
      event.attributions.filter(({ role }) => role === 'assistant'),
    ).toHaveLength(2);
  });

  test('merges byte-identical records only when strong identity evidence exists', () => {
    const first = navalLossRecord({ recordId: 'copy-1', sourceOffset: 100 });
    const second = navalLossRecord({ recordId: 'copy-2', sourceOffset: 101 });
    const events = deduplicateNavalLosses([first, second]);

    expect(events).toHaveLength(1);
    expect(events[0].sourceRecordIds).toEqual(['copy-1', 'copy-2']);
  });

  test('keeps different non-empty ship names in the same battle separate', () => {
    const events = deduplicateNavalLosses([
      navalLossRecord({
        sunkShip: { name: 'Destroyer One', definition: 'destroyer' },
      }),
      navalLossRecord({
        recordId: 'destroyer-2',
        sourceOffset: 101,
        sunkShip: { name: 'Destroyer Two', definition: 'destroyer' },
      }),
    ]);

    expect(events).toHaveLength(2);
  });

  test('keeps the same name and date for different sunk countries separate', () => {
    const events = deduplicateNavalLosses([
      navalLossRecord(),
      navalLossRecord({
        recordId: 'other-country',
        sourceOffset: 101,
        sunkShip: { countryTag: 'ITA' },
      }),
    ]);

    expect(events).toHaveLength(2);
  });

  test('keeps reused names on clearly different dates separate', () => {
    const events = deduplicateNavalLosses([
      navalLossRecord(),
      navalLossRecord({
        recordId: 'later-loss',
        sourceOffset: 101,
        event: { date: '1944.1.1.1' },
      }),
    ]);

    expect(events).toHaveLength(2);
  });

  test('keeps different named definitions in the same battle separate', () => {
    const events = deduplicateNavalLosses([
      navalLossRecord({ sunkShip: { name: 'One', definition: 'destroyer' } }),
      navalLossRecord({
        recordId: 'two',
        sourceOffset: 101,
        sunkShip: { name: 'Two', definition: 'heavy_cruiser' },
      }),
    ]);

    expect(events).toHaveLength(2);
  });

  test('keeps empty names with weak evidence separate', () => {
    const weak = {
      sunkShip: { name: '', equipmentVariant: ZERO_ID },
      attribution: { killerName: null, killerCountryTag: null },
      event: { battle: ZERO_ID },
    };
    const events = deduplicateNavalLosses([
      navalLossRecord({ recordId: 'empty-1', ...weak }),
      shipHistoryRecord({ recordId: 'empty-2', ...weak }),
    ]);

    expect(events).toHaveLength(2);
  });

  test('merges empty names only with strong cross-source evidence', () => {
    const global = navalLossRecord({
      recordId: 'empty-global',
      sunkShip: { name: '' },
    });
    const ship = shipHistoryRecord({
      recordId: 'empty-ship',
      sunkShip: { name: '' },
    });
    const events = deduplicateNavalLosses([global, ship]);

    expect(events).toHaveLength(1);
    expect(events[0].rawRecordCount).toBe(2);
  });

  test('does not merge strong empty-name evidence within one source', () => {
    const events = deduplicateNavalLosses([
      navalLossRecord({ recordId: 'empty-global-1', sunkShip: { name: '' } }),
      navalLossRecord({
        recordId: 'empty-global-2',
        sourceOffset: 101,
        sunkShip: { name: '' },
      }),
    ]);

    expect(events).toHaveLength(2);
  });

  test('does not use battle.id=0 as strong identity evidence', () => {
    const weak = {
      attribution: { killerName: null, killerCountryTag: null },
      event: { battle: ZERO_ID },
    };
    const events = deduplicateNavalLosses([
      navalLossRecord({ recordId: 'zero-battle-1', ...weak }),
      navalLossRecord({
        recordId: 'zero-battle-2',
        sourceOffset: 101,
        ...weak,
      }),
    ]);

    expect(events).toHaveLength(2);
  });

  test('does not use equipment_variant.id=0 as strong empty-name evidence', () => {
    const weak = { sunkShip: { name: '', equipmentVariant: ZERO_ID } };
    const events = deduplicateNavalLosses([
      navalLossRecord({ recordId: 'zero-variant-global', ...weak }),
      shipHistoryRecord({ recordId: 'zero-variant-ship', ...weak }),
    ]);

    expect(events).toHaveLength(2);
  });

  test('does not collapse multiple named ships using the same equipment variant', () => {
    const events = deduplicateNavalLosses([
      navalLossRecord({ sunkShip: { name: 'Ship One' } }),
      navalLossRecord({
        recordId: 'ship-two',
        sourceOffset: 101,
        sunkShip: { name: 'Ship Two' },
      }),
    ]);

    expect(events).toHaveLength(2);
  });

  test('does not collapse multiple ships sunk by the same killer in one battle', () => {
    const events = deduplicateNavalLosses([
      navalLossRecord({ sunkShip: { name: 'Victim One' } }),
      navalLossRecord({
        recordId: 'victim-two',
        sourceOffset: 101,
        sunkShip: { name: 'Victim Two' },
      }),
    ]);

    expect(events).toHaveLength(2);
  });

  test('attaches multiple assistants without increasing the event count', () => {
    const events = deduplicateNavalLosses([
      navalLossRecord(),
      shipHistoryRecord({
        recordId: 'assistant-a',
        attribution: { assist: true },
      }),
      shipHistoryRecord({
        recordId: 'assistant-b',
        sourceOffset: 201,
        attribution: { assist: true, killerName: 'HMS Other' },
      }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].rawRecordCount).toBe(3);
  });

  test('keeps an assistant from an unrelated loss separate', () => {
    const events = deduplicateNavalLosses([
      navalLossRecord(),
      shipHistoryRecord({
        recordId: 'unrelated-assistant',
        sunkShip: { name: 'Different Victim' },
        attribution: { assist: true },
      }),
    ]);

    expect(events).toHaveLength(2);
  });

  test('keeps assist=null unresolved for a ship-history attribution', () => {
    const [event] = deduplicateNavalLosses([shipHistoryRecord()]);

    expect(event.attributions[0].role).toBe('unresolved');
  });

  test('preserves unknown or modded ship definitions', () => {
    const [event] = deduplicateNavalLosses([
      navalLossRecord({ sunkShip: { definition: 'mod_super_dreadnought' } }),
    ]);

    expect(event.sunkShip.definition).toBe('mod_super_dreadnought');
  });

  test('preserves conflicting killer attribution instead of overwriting it', () => {
    const [event] = deduplicateNavalLosses([
      navalLossRecord({ recordId: 'killer-one' }),
      navalLossRecord({
        recordId: 'killer-two',
        sourceOffset: 101,
        attribution: {
          killerName: 'USS Example',
          killerCountryTag: 'USA',
          killerDefinition: 'heavy_cruiser',
        },
      }),
    ]);

    expect(event.attributions).toHaveLength(2);
    expect(event.ambiguityReasons).toContain(
      'conflicting primary killer attribution',
    );
  });

  test('merges high identity with conflicting optional values and reports them', () => {
    const [event] = deduplicateNavalLosses([
      navalLossRecord(),
      shipHistoryRecord({
        recordId: 'other-location',
        event: { location: 9999 },
      }),
    ]);

    expect(event.rawRecordCount).toBe(2);
    expect(event.event.location).toBe(8522);
    expect(event.ambiguityReasons).toContain(
      'conflicting event.location values: 8522, 9999',
    );
  });

  test('keeps conflicting optional values separate without high evidence', () => {
    const events = deduplicateNavalLosses([
      navalLossRecord({ event: { battle: null } }),
      shipHistoryRecord({
        recordId: 'other-convoy',
        event: { battle: null, convoyRelated: true },
      }),
    ]);

    expect(events).toHaveLength(2);
  });

  test('uses an exact high match when a weaker medium key is ambiguous', () => {
    const first = navalLossRecord({ recordId: 'variant-one' });
    const conflicting = navalLossRecord({
      recordId: 'variant-two',
      sourceOffset: 101,
      sunkShip: {
        equipmentVariant: { id: 7000, type: 70, status: 'valid' },
      },
    });
    const repeat = navalLossRecord({
      recordId: 'variant-one-repeat',
      sourceOffset: 102,
    });
    const events = deduplicateNavalLosses([first, conflicting, repeat]);

    expect(events).toHaveLength(2);
    expect(events.map(({ rawRecordCount }) => rawRecordCount).sort()).toEqual([
      1, 2,
    ]);
  });

  test('preserves all source record IDs after a merge', () => {
    const [event] = deduplicateNavalLosses([
      navalLossRecord({ recordId: 'global-copy' }),
      shipHistoryRecord({ recordId: 'ship-copy' }),
      shipHistoryRecord({
        recordId: 'assistant-copy',
        sourceOffset: 201,
        attribution: { assist: true },
      }),
    ]);

    expect(event.sourceRecordIds).toEqual([
      'global-copy',
      'ship-copy',
      'assistant-copy',
    ]);
  });

  test('reports rawRecordCount as the contributing raw record count', () => {
    const [event] = deduplicateNavalLosses([
      navalLossRecord(),
      shipHistoryRecord(),
    ]);

    expect(event.rawRecordCount).toBe(event.sourceRecordIds.length);
    expect(event.rawRecordCount).toBe(2);
  });

  test('reports global-history source presence accurately', () => {
    const [event] = deduplicateNavalLosses([navalLossRecord()]);

    expect(event.sourceSummary).toEqual({
      hasGlobalHistoryRecord: true,
      hasShipHistoryRecord: false,
      globalHistoryRecords: 1,
      shipHistoryRecords: 0,
    });
  });

  test('reports ship-history source presence accurately', () => {
    const [event] = deduplicateNavalLosses([shipHistoryRecord()]);

    expect(event.sourceSummary).toEqual({
      hasGlobalHistoryRecord: false,
      hasShipHistoryRecord: true,
      globalHistoryRecords: 0,
      shipHistoryRecords: 1,
    });
  });

  test('orders events by their earliest contributing source occurrence', () => {
    const lateGlobal = navalLossRecord({
      recordId: 'late-global',
      sourceOffset: 500,
    });
    const earlyCopy = shipHistoryRecord({
      recordId: 'early-copy',
      sourceOffset: 100,
    });
    const middleEvent = navalLossRecord({
      recordId: 'middle-event',
      sourceOffset: 200,
      sunkShip: { name: 'Middle Victim' },
    });
    const events = deduplicateNavalLosses([lateGlobal, middleEvent, earlyCopy]);

    expect(events.map(({ sourceRecordIds }) => sourceRecordIds)).toEqual([
      ['early-copy', 'late-global'],
      ['middle-event'],
    ]);
  });

  test('is deeply deterministic for repeated runs', () => {
    const records = [navalLossRecord(), shipHistoryRecord()];
    const first = deduplicateNavalLosses(records);
    const second = deduplicateNavalLosses(records);

    expect(second).toEqual(first);
  });

  test('does not mutate input records or arrays', () => {
    const records = [navalLossRecord(), shipHistoryRecord()];
    const before = JSON.parse(JSON.stringify(records)) as ParsedNavalLoss[];

    deduplicateNavalLosses(records, [navalLossParentContext()]);

    expect(records).toEqual(before);
  });

  test('does not crash on malformed or partial raw records', () => {
    const partial = navalLossRecord({
      recordId: 'partial',
      complete: false,
      warnings: ['missing battle'],
      sunkShip: {
        name: null,
        countryTag: null,
        definition: null,
        level: null,
        equipmentVariant: null,
      },
      attribution: {
        killerName: null,
        killerCountryTag: null,
        killerDefinition: null,
        assist: null,
      },
      event: {
        date: null,
        location: null,
        battle: null,
        convoyRelated: null,
      },
    });

    expect(() => deduplicateNavalLosses([partial])).not.toThrow();
    expect(deduplicateNavalLosses([partial])[0]).toMatchObject({
      confidence: 'low',
      deduplicationStatus: 'ambiguous',
      countable: false,
    });
  });

  test('uses medium evidence when battle identity is absent', () => {
    const first = navalLossRecord({
      recordId: 'medium-1',
      event: { battle: null },
    });
    const second = shipHistoryRecord({
      recordId: 'medium-2',
      event: { battle: null },
    });
    const [event] = deduplicateNavalLosses([first, second]);

    expect(event.rawRecordCount).toBe(2);
    expect(event.confidence).toBe('medium');
  });

  test('accepts one-sided missing optional identity without inventing a conflict', () => {
    const first = navalLossRecord({
      recordId: 'missing-variant',
      sunkShip: { equipmentVariant: null },
    });
    const second = shipHistoryRecord({ recordId: 'explicit-variant' });
    const [event] = deduplicateNavalLosses([first, second]);

    expect(event.rawRecordCount).toBe(2);
    expect(event.sunkShip.equipmentVariant).toEqual({
      id: 6032,
      type: 70,
      status: 'valid',
    });
  });

  test('uses parent ship provenance as corroborating medium evidence', () => {
    const global = navalLossRecord({
      recordId: 'parent-match-global',
      event: { battle: null },
    });
    const ship = shipHistoryRecord({
      recordId: 'parent-match-ship',
      event: { battle: null },
      attribution: { killerName: null, killerCountryTag: null },
    });
    const [event] = deduplicateNavalLosses(
      [global, ship],
      [navalLossParentContext()],
    );

    expect(event.rawRecordCount).toBe(2);
    expect(
      event.attributions.some(
        ({ parentContextId }) => parentContextId === 'context-1',
      ),
    ).toBe(true);
  });

  test('processes a large synthetic set without quadratic pair comparison', () => {
    const records = Array.from({ length: 10_000 }, (_, index) =>
      navalLossRecord({
        recordId: `synthetic-${index}`,
        sourceOffset: index,
        ordinal: index,
        sunkShip: { name: `Synthetic Ship ${index}` },
      }),
    );
    const startedAt = Date.now();
    const events = deduplicateNavalLosses(records);

    expect(events).toHaveLength(records.length);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  test('attaches a large assistant cluster without quadratic source scans', () => {
    const records = [
      navalLossRecord({ recordId: 'empty-anchor', sunkShip: { name: '' } }),
      ...Array.from({ length: 5_000 }, (_, index) =>
        shipHistoryRecord({
          recordId: `empty-assistant-${index}`,
          sourceOffset: index + 200,
          ordinal: index,
          sunkShip: { name: '' },
          attribution: { assist: true },
        }),
      ),
    ];
    const startedAt = Date.now();
    const events = deduplicateNavalLosses(records);

    expect(events).toHaveLength(1);
    expect(events[0].rawRecordCount).toBe(records.length);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });
});
