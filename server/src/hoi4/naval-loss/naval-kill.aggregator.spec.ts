import {
  assistantAttribution,
  creditedNavalKill,
  navalKillEvent,
  primaryAttribution,
} from './fixtures/naval-kill.fixture';
import { aggregateCreditedNavalKills } from './naval-kill.aggregator';
import { resolveCreditedNavalKill } from './naval-kill.resolver';
import type { CreditedNavalKill } from './naval-loss.types';

describe('credited naval-kill aggregation', () => {
  test('returns empty summaries for no credited kills', () => {
    expect(aggregateCreditedNavalKills([])).toEqual({
      countrySummaries: [],
      killerShipSummaries: [],
    });
  });

  test('aggregates one credited kill into one country summary', () => {
    const result = aggregateCreditedNavalKills([creditedNavalKill()]);

    expect(result.countrySummaries).toEqual([
      {
        countryTag: 'GER',
        creditedKills: 1,
        byVictimType: [{ definition: 'destroyer', count: 1 }],
      },
    ]);
  });

  test('aggregates multiple kills by one country', () => {
    const result = aggregateCreditedNavalKills([
      creditedNavalKill({ eventId: 'event-1' }),
      creditedNavalKill({ eventId: 'event-2' }),
      creditedNavalKill({ eventId: 'event-3' }),
    ]);

    expect(result.countrySummaries[0].creditedKills).toBe(3);
  });

  test('keeps different killer countries separate', () => {
    const result = aggregateCreditedNavalKills([
      creditedNavalKill({ killerCountryTag: 'GER' }),
      creditedNavalKill({ killerCountryTag: 'ITA' }),
    ]);

    expect(result.countrySummaries.map(({ countryTag }) => countryTag)).toEqual(
      ['GER', 'ITA'],
    );
  });

  test('counts one country kill for one logical sinking', () => {
    const result = aggregateCreditedNavalKills([creditedNavalKill()]);

    expect(
      result.countrySummaries.reduce(
        (sum, summary) => sum + summary.creditedKills,
        0,
      ),
    ).toBe(1);
  });

  test('assistant evidence does not affect aggregated totals', () => {
    const resolution = resolveCreditedNavalKill(
      navalKillEvent({
        attributions: [primaryAttribution(), assistantAttribution()],
      }),
    );
    const result = aggregateCreditedNavalKills(
      resolution.creditedKill ? [resolution.creditedKill] : [],
    );

    expect(result.countrySummaries[0].creditedKills).toBe(1);
  });

  test('aggregates victim ship types', () => {
    const result = aggregateCreditedNavalKills([
      creditedNavalKill({ eventId: '1' }),
      creditedNavalKill({ eventId: '2' }),
      creditedNavalKill({
        eventId: '3',
        sunkShip: { definition: 'submarine' },
      }),
    ]);

    expect(result.countrySummaries[0].byVictimType).toEqual([
      { definition: 'destroyer', count: 2 },
      { definition: 'submarine', count: 1 },
    ]);
  });

  test('groups a missing victim type under unknown', () => {
    const result = aggregateCreditedNavalKills([
      creditedNavalKill({ sunkShip: { definition: null } }),
    ]);

    expect(result.countrySummaries[0].byVictimType).toEqual([
      { definition: 'unknown', count: 1 },
    ]);
  });

  test('orders countries by kills descending then tag ascending', () => {
    const result = aggregateCreditedNavalKills([
      creditedNavalKill({ eventId: '1', killerCountryTag: 'USA' }),
      creditedNavalKill({ eventId: '2', killerCountryTag: 'ITA' }),
      creditedNavalKill({ eventId: '3', killerCountryTag: 'GER' }),
      creditedNavalKill({ eventId: '4', killerCountryTag: 'GER' }),
    ]);

    expect(
      result.countrySummaries.map(({ countryTag, creditedKills }) => [
        countryTag,
        creditedKills,
      ]),
    ).toEqual([
      ['GER', 2],
      ['ITA', 1],
      ['USA', 1],
    ]);
  });

  test('orders victim types by count descending then definition ascending', () => {
    const result = aggregateCreditedNavalKills([
      creditedNavalKill({ eventId: '1', sunkShip: { definition: 'carrier' } }),
      creditedNavalKill({
        eventId: '2',
        sunkShip: { definition: 'submarine' },
      }),
      creditedNavalKill({
        eventId: '3',
        sunkShip: { definition: 'destroyer' },
      }),
      creditedNavalKill({
        eventId: '4',
        sunkShip: { definition: 'destroyer' },
      }),
    ]);

    expect(result.countrySummaries[0].byVictimType).toEqual([
      { definition: 'destroyer', count: 2 },
      { definition: 'carrier', count: 1 },
      { definition: 'submarine', count: 1 },
    ]);
  });

  test('aggregates multiple kills for one safely identified killer ship', () => {
    const result = aggregateCreditedNavalKills([
      creditedNavalKill({ eventId: '1' }),
      creditedNavalKill({ eventId: '2' }),
    ]);

    expect(result.killerShipSummaries).toHaveLength(1);
    expect(result.killerShipSummaries[0].creditedKills).toBe(2);
  });

  test('keeps different safe killer ships from one country separate', () => {
    const result = aggregateCreditedNavalKills([
      creditedNavalKill({ eventId: '1' }),
      creditedNavalKill({
        eventId: '2',
        killerShip: {
          name: 'KMS Other',
          identity: { id: 34, type: 51 },
        },
      }),
    ]);

    expect(result.killerShipSummaries).toHaveLength(2);
  });

  test('keeps identical display names with incompatible safe identities separate', () => {
    const result = aggregateCreditedNavalKills([
      creditedNavalKill({
        eventId: '1',
        killerShip: { name: 'Reused Name', identity: { id: 33, type: 51 } },
      }),
      creditedNavalKill({
        eventId: '2',
        killerShip: { name: 'Reused Name', identity: { id: 99, type: 51 } },
      }),
    ]);

    expect(result.killerShipSummaries).toHaveLength(2);
    expect(result.killerShipSummaries.map(({ shipId }) => shipId.id)).toEqual([
      33, 99,
    ]);
  });

  test('excludes unsafe name-only ship evidence from ship summaries', () => {
    const result = aggregateCreditedNavalKills([
      creditedNavalKill({
        killerShip: { identity: null },
        shipCreditResolved: false,
      }),
    ]);

    expect(result.countrySummaries[0].creditedKills).toBe(1);
    expect(result.killerShipSummaries).toEqual([]);
  });

  test('country totals equal the credited record count', () => {
    const kills = [
      creditedNavalKill({ eventId: '1' }),
      creditedNavalKill({ eventId: '2', killerCountryTag: 'ITA' }),
      creditedNavalKill({ eventId: '3', killerCountryTag: 'USA' }),
    ];
    const result = aggregateCreditedNavalKills(kills);

    expect(
      result.countrySummaries.reduce(
        (sum, summary) => sum + summary.creditedKills,
        0,
      ),
    ).toBe(kills.length);
  });

  test('killer-ship totals never exceed credited record count', () => {
    const kills = [
      creditedNavalKill({ eventId: '1' }),
      creditedNavalKill({
        eventId: '2',
        killerShip: { identity: null },
        shipCreditResolved: false,
      }),
    ];
    const result = aggregateCreditedNavalKills(kills);

    expect(
      result.killerShipSummaries.reduce(
        (sum, summary) => sum + summary.creditedKills,
        0,
      ),
    ).toBeLessThanOrEqual(kills.length);
  });

  test('does not mutate credited kill inputs', () => {
    const kills = [creditedNavalKill()];
    const before = JSON.parse(JSON.stringify(kills)) as CreditedNavalKill[];

    aggregateCreditedNavalKills(kills);

    expect(kills).toEqual(before);
  });

  test('returns deeply equal results on repeated aggregation', () => {
    const kills = [
      creditedNavalKill({ eventId: '1' }),
      creditedNavalKill({ eventId: '2', killerCountryTag: 'ITA' }),
    ];

    expect(aggregateCreditedNavalKills(kills)).toEqual(
      aggregateCreditedNavalKills(kills),
    );
  });
});
