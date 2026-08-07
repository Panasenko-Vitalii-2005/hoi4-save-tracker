import { navalLossEvent } from './fixtures/aggregation.fixture';
import {
  aggregateNavalLosses,
  UNKNOWN_NAVAL_LOSS_TYPE,
} from './naval-loss.aggregator';
import type { NavalLossEvent } from './naval-loss.types';

describe('aggregateNavalLosses', () => {
  test('returns no summaries for an empty event array', () => {
    expect(aggregateNavalLosses([])).toEqual([]);
  });

  test('counts one loss for one country', () => {
    expect(aggregateNavalLosses([navalLossEvent()])).toEqual([
      {
        countryTag: 'ENG',
        totalLost: 1,
        byType: [{ definition: 'destroyer', count: 1 }],
      },
    ]);
  });

  test('sums multiple losses for one country', () => {
    const summaries = aggregateNavalLosses([
      navalLossEvent({ eventId: 'event-1' }),
      navalLossEvent({ eventId: 'event-2' }),
      navalLossEvent({ eventId: 'event-3' }),
    ]);

    expect(summaries[0].totalLost).toBe(3);
  });

  test('keeps countries separate', () => {
    const summaries = aggregateNavalLosses([
      navalLossEvent({ sunkShip: { countryTag: 'ENG' } }),
      navalLossEvent({ sunkShip: { countryTag: 'GER' } }),
    ]);

    expect(summaries.map(({ countryTag }) => countryTag)).toEqual([
      'ENG',
      'GER',
    ]);
  });

  test('increments one bucket for repeated ship types', () => {
    const [summary] = aggregateNavalLosses([
      navalLossEvent({ eventId: 'event-1' }),
      navalLossEvent({ eventId: 'event-2' }),
    ]);

    expect(summary.byType).toEqual([{ definition: 'destroyer', count: 2 }]);
  });

  test('keeps different ship types separate', () => {
    const [summary] = aggregateNavalLosses([
      navalLossEvent({ sunkShip: { definition: 'destroyer' } }),
      navalLossEvent({ sunkShip: { definition: 'submarine' } }),
    ]);

    expect(summary.byType).toEqual([
      { definition: 'destroyer', count: 1 },
      { definition: 'submarine', count: 1 },
    ]);
  });

  test.each([null, '', '   '])(
    'groups unusable ship definition %p under unknown',
    (definition) => {
      const [summary] = aggregateNavalLosses([
        navalLossEvent({ sunkShip: { definition } }),
      ]);

      expect(summary.byType).toEqual([
        { definition: UNKNOWN_NAVAL_LOSS_TYPE, count: 1 },
      ]);
    },
  );

  test('preserves a modded ship definition', () => {
    const definition = 'super_heavy_modded_cruiser';
    const [summary] = aggregateNavalLosses([
      navalLossEvent({ sunkShip: { definition } }),
    ]);

    expect(summary.byType).toEqual([{ definition, count: 1 }]);
  });

  test('attributes a loss to the sunk country rather than killer country', () => {
    const [summary] = aggregateNavalLosses([
      navalLossEvent({
        sunkShip: { countryTag: 'ENG' },
        attributions: [
          {
            role: 'primary_observed',
            killerName: 'KMS Example',
            killerCountryTag: 'GER',
            killerDefinition: 'submarine',
            sourceRecordIds: ['record-1'],
            parentContextId: null,
          },
        ],
      }),
    ]);

    expect(summary.countryTag).toBe('ENG');
  });

  test('does not use parent ship provenance for ownership', () => {
    const [summary] = aggregateNavalLosses([
      navalLossEvent({
        sunkShip: { countryTag: 'ENG' },
        attributions: [
          {
            role: 'primary_observed',
            killerName: 'Parent Ship',
            killerCountryTag: 'GER',
            killerDefinition: 'battleship',
            sourceRecordIds: ['ship_history:200:0'],
            parentContextId: 'GER-parent-ship',
          },
        ],
      }),
    ]);

    expect(summary.countryTag).toBe('ENG');
  });

  test('assistant attribution does not increase the loss count', () => {
    const [summary] = aggregateNavalLosses([
      navalLossEvent({
        attributions: [
          {
            role: 'primary_observed',
            killerName: 'Primary',
            killerCountryTag: 'GER',
            killerDefinition: 'submarine',
            sourceRecordIds: ['record-1'],
            parentContextId: 'primary-context',
          },
          {
            role: 'assistant',
            killerName: 'Assistant',
            killerCountryTag: 'ITA',
            killerDefinition: 'destroyer',
            sourceRecordIds: ['record-2'],
            parentContextId: 'assistant-context',
          },
        ],
      }),
    ]);

    expect(summary.totalLost).toBe(1);
  });

  test('counts one normalized event with ten raw records as one loss', () => {
    const [summary] = aggregateNavalLosses([
      navalLossEvent({ rawRecordCount: 10 }),
    ]);

    expect(summary.totalLost).toBe(1);
  });

  test('counts distinct events in the same battle independently', () => {
    const events = Array.from({ length: 20 }, (_, index) =>
      navalLossEvent({
        eventId: `event-${index}`,
        sunkShip: { name: `Ship ${index}` },
        event: { battle: { id: 77, type: 4713, status: 'valid' } },
      }),
    );

    expect(aggregateNavalLosses(events)[0].totalLost).toBe(20);
  });

  test('counts reused ship names on distinct events independently', () => {
    const [summary] = aggregateNavalLosses([
      navalLossEvent({ eventId: 'event-1', sunkShip: { name: 'Reused' } }),
      navalLossEvent({ eventId: 'event-2', sunkShip: { name: 'Reused' } }),
    ]);

    expect(summary.totalLost).toBe(2);
  });

  test.each([null, '', '   '])(
    'groups unusable country tag %p in an explicit null bucket',
    (countryTag) => {
      const [summary] = aggregateNavalLosses([
        navalLossEvent({ sunkShip: { countryTag } }),
      ]);

      expect(summary.countryTag).toBeNull();
      expect(summary.totalLost).toBe(1);
    },
  );

  test('orders countries by total descending, then tag ascending with unknown last', () => {
    const summaries = aggregateNavalLosses([
      navalLossEvent({ eventId: '1', sunkShip: { countryTag: 'USA' } }),
      navalLossEvent({ eventId: '2', sunkShip: { countryTag: null } }),
      navalLossEvent({ eventId: '3', sunkShip: { countryTag: 'ENG' } }),
      navalLossEvent({ eventId: '4', sunkShip: { countryTag: 'GER' } }),
      navalLossEvent({ eventId: '5', sunkShip: { countryTag: 'GER' } }),
    ]);

    expect(
      summaries.map(({ countryTag, totalLost }) => [countryTag, totalLost]),
    ).toEqual([
      ['GER', 2],
      ['ENG', 1],
      ['USA', 1],
      [null, 1],
    ]);
  });

  test('orders types by count descending, then definition ascending', () => {
    const [summary] = aggregateNavalLosses([
      navalLossEvent({ eventId: '1', sunkShip: { definition: 'submarine' } }),
      navalLossEvent({ eventId: '2', sunkShip: { definition: 'carrier' } }),
      navalLossEvent({ eventId: '3', sunkShip: { definition: 'destroyer' } }),
      navalLossEvent({ eventId: '4', sunkShip: { definition: 'destroyer' } }),
    ]);

    expect(summary.byType).toEqual([
      { definition: 'destroyer', count: 2 },
      { definition: 'carrier', count: 1 },
      { definition: 'submarine', count: 1 },
    ]);
  });

  test('each country total equals the sum of its type buckets', () => {
    const summaries = aggregateNavalLosses([
      navalLossEvent({ sunkShip: { countryTag: 'ENG', definition: null } }),
      navalLossEvent({
        sunkShip: { countryTag: 'ENG', definition: 'carrier' },
      }),
      navalLossEvent({
        sunkShip: { countryTag: 'GER', definition: 'submarine' },
      }),
    ]);

    for (const summary of summaries) {
      expect(summary.byType.reduce((sum, type) => sum + type.count, 0)).toBe(
        summary.totalLost,
      );
    }
  });

  test('global summary total equals the logical event count', () => {
    const events = [
      navalLossEvent({ sunkShip: { countryTag: 'ENG' } }),
      navalLossEvent({ sunkShip: { countryTag: 'GER' } }),
      navalLossEvent({ sunkShip: { countryTag: null } }),
    ];
    const summaries = aggregateNavalLosses(events);

    expect(summaries.reduce((sum, summary) => sum + summary.totalLost, 0)).toBe(
      events.length,
    );
  });

  test('does not mutate the input events', () => {
    const events = [
      navalLossEvent({
        sunkShip: { countryTag: ' ENG ', definition: ' destroyer ' },
      }),
    ];
    const before = JSON.parse(JSON.stringify(events)) as NavalLossEvent[];

    aggregateNavalLosses(events);

    expect(events).toEqual(before);
  });

  test('returns deeply equal results on repeated aggregation', () => {
    const events = [
      navalLossEvent({ sunkShip: { countryTag: 'GER' } }),
      navalLossEvent({ sunkShip: { countryTag: 'ENG' } }),
    ];

    expect(aggregateNavalLosses(events)).toEqual(aggregateNavalLosses(events));
  });

  test('counts ambiguous events carrying warnings', () => {
    const [summary] = aggregateNavalLosses([
      navalLossEvent({
        confidence: 'low',
        deduplicationStatus: 'ambiguous',
        countable: false,
        ambiguityReasons: ['malformed source record'],
      }),
    ]);

    expect(summary.totalLost).toBe(1);
  });

  test('counts a ship with an empty name', () => {
    const [summary] = aggregateNavalLosses([
      navalLossEvent({ sunkShip: { name: '' } }),
    ]);

    expect(summary.totalLost).toBe(1);
  });

  test('ignores zero-sentinel battle and equipment IDs when aggregating', () => {
    const [summary] = aggregateNavalLosses([
      navalLossEvent({
        sunkShip: {
          equipmentVariant: { id: 0, type: 0, status: 'zero_sentinel' },
        },
        event: {
          battle: { id: 0, type: 0, status: 'zero_sentinel' },
        },
      }),
    ]);

    expect(summary).toEqual({
      countryTag: 'ENG',
      totalLost: 1,
      byType: [{ definition: 'destroyer', count: 1 }],
    });
  });
});
