import {
  assistantAttribution,
  killerParentContext,
  navalKillEvent,
  primaryAttribution,
  unresolvedAttribution,
} from './fixtures/naval-kill.fixture';
import {
  resolveCreditedNavalKill,
  resolveCreditedNavalKills,
} from './naval-kill.resolver';
import type {
  NavalLossEvent,
  NavalLossParentContext,
} from './naval-loss.types';

describe('credited naval-kill resolution', () => {
  test('resolves one credited kill from clear primary country and ship evidence', () => {
    const event = navalKillEvent({
      attributions: [primaryAttribution({ parentContextId: 'killer-context' })],
    });
    const result = resolveCreditedNavalKill(event, [killerParentContext()]);

    expect(result).toMatchObject({
      countryResolution: 'credited',
      shipResolution: 'resolved',
      creditedKill: {
        killerCountryTag: 'GER',
        shipCreditResolved: true,
        killerShip: {
          name: 'KMS Example',
          definition: 'submarine',
          identity: { id: 33, type: 51 },
        },
      },
    });
  });

  test('keeps country credit when no safe ship identity exists', () => {
    const result = resolveCreditedNavalKill(navalKillEvent());

    expect(result.creditedKill).toMatchObject({
      killerCountryTag: 'GER',
      shipCreditResolved: false,
      killerShip: {
        name: 'KMS Example',
        identity: null,
      },
    });
  });

  test('does not credit assistant-only evidence', () => {
    const result = resolveCreditedNavalKill(
      navalKillEvent({ attributions: [assistantAttribution()] }),
    );

    expect(result.countryResolution).toBe('no_primary_attribution');
    expect(result.creditedKill).toBeNull();
  });

  test('credits exactly one kill for a primary plus one assistant', () => {
    const results = resolveCreditedNavalKills([
      navalKillEvent({
        attributions: [primaryAttribution(), assistantAttribution()],
      }),
    ]);

    expect(results.filter(({ creditedKill }) => creditedKill)).toHaveLength(1);
  });

  test('credits exactly one kill for a primary plus ten assistants', () => {
    const assistants = Array.from({ length: 10 }, (_, index) =>
      assistantAttribution({
        killerName: `Assistant ${index}`,
        parentContextId: `assistant-${index}`,
      }),
    );
    const result = resolveCreditedNavalKill(
      navalKillEvent({
        attributions: [primaryAttribution(), ...assistants],
      }),
    );

    expect(result.creditedKill).not.toBeNull();
  });

  test('collapses compatible duplicate primary observations into one kill', () => {
    const result = resolveCreditedNavalKill(
      navalKillEvent({
        attributions: [
          primaryAttribution({ parentContextId: 'killer-context' }),
          primaryAttribution({
            sourceRecordIds: ['ship_history:200:0'],
            parentContextId: 'killer-context',
          }),
        ],
      }),
      [killerParentContext()],
    );

    expect(result.creditedKill?.killerCountryTag).toBe('GER');
    expect(result.creditedKill?.shipCreditResolved).toBe(true);
  });

  test('keeps country credit but rejects conflicting primary killer ships', () => {
    const result = resolveCreditedNavalKill(
      navalKillEvent({
        attributions: [
          primaryAttribution({ killerName: 'Bismarck' }),
          primaryAttribution({ killerName: 'Scharnhorst' }),
        ],
      }),
    );

    expect(result.countryResolution).toBe('credited');
    expect(result.shipResolution).toBe('conflicting_killer_ships');
    expect(result.creditedKill).toMatchObject({
      killerCountryTag: 'GER',
      killerShip: null,
      shipCreditResolved: false,
    });
  });

  test('rejects conflicting primary killer countries', () => {
    const result = resolveCreditedNavalKill(
      navalKillEvent({
        attributions: [
          primaryAttribution({ killerCountryTag: 'GER' }),
          primaryAttribution({ killerCountryTag: 'ITA' }),
        ],
      }),
    );

    expect(result.countryResolution).toBe('conflicting_killer_countries');
    expect(result.creditedKill).toBeNull();
  });

  test('requires an explicit primary killer country', () => {
    const result = resolveCreditedNavalKill(
      navalKillEvent({
        attributions: [
          primaryAttribution({
            killerCountryTag: null,
            parentContextId: 'killer-context',
          }),
        ],
      }),
      [killerParentContext()],
    );

    expect(result.countryResolution).toBe('missing_killer_country');
    expect(result.creditedKill).toBeNull();
  });

  test('does not credit an event with no attribution', () => {
    const result = resolveCreditedNavalKill(
      navalKillEvent({ attributions: [] }),
    );

    expect(result.creditedKill).toBeNull();
  });

  test('does not reinterpret assist=null unresolved evidence as primary', () => {
    const result = resolveCreditedNavalKill(
      navalKillEvent({ attributions: [unresolvedAttribution()] }),
      [killerParentContext()],
    );

    expect(result.countryResolution).toBe('no_primary_attribution');
    expect(result.creditedKill).toBeNull();
  });

  test('unknown victim ship name does not prevent country credit', () => {
    const result = resolveCreditedNavalKill(
      navalKillEvent({ sunkShip: { name: null } }),
    );

    expect(result.creditedKill?.sunkShip.name).toBeNull();
  });

  test('unknown victim definition does not prevent country credit', () => {
    const result = resolveCreditedNavalKill(
      navalKillEvent({ sunkShip: { definition: null } }),
    );

    expect(result.creditedKill?.sunkShip.definition).toBeNull();
  });

  test('preserves a modded victim definition', () => {
    const definition = 'mod_super_dreadnought';
    const result = resolveCreditedNavalKill(
      navalKillEvent({ sunkShip: { definition } }),
    );

    expect(result.creditedKill?.sunkShip.definition).toBe(definition);
  });

  test('does not treat a zero-sentinel parent ship ID as safe identity', () => {
    const result = resolveCreditedNavalKill(
      navalKillEvent({
        attributions: [
          primaryAttribution({ parentContextId: 'killer-context' }),
        ],
      }),
      [
        killerParentContext({
          shipId: { id: 0, type: 0, status: 'zero_sentinel' },
        }),
      ],
    );

    expect(result.shipResolution).toBe('missing_safe_identity');
    expect(result.creditedKill?.shipCreditResolved).toBe(false);
  });

  test('does not turn killer name alone into a safe persistent identity', () => {
    const result = resolveCreditedNavalKill(navalKillEvent());

    expect(result.creditedKill?.killerShip).toEqual({
      name: 'KMS Example',
      definition: 'submarine',
      identity: null,
    });
    expect(result.creditedKill?.shipCreditResolved).toBe(false);
  });

  test('uses matching unresolved provenance to support an explicit primary killer', () => {
    const result = resolveCreditedNavalKill(
      navalKillEvent({
        attributions: [primaryAttribution(), unresolvedAttribution()],
      }),
      [killerParentContext()],
    );

    expect(result.shipResolution).toBe('resolved');
    expect(result.creditedKill?.killerShip?.identity).toEqual({
      id: 33,
      type: 51,
    });
  });

  test('does not use a different-country parent context as safe ship identity', () => {
    const result = resolveCreditedNavalKill(
      navalKillEvent({
        attributions: [
          primaryAttribution({ parentContextId: 'killer-context' }),
        ],
      }),
      [killerParentContext({ countryTag: 'ENG' })],
    );

    expect(result.countryResolution).toBe('credited');
    expect(result.shipResolution).toBe('missing_safe_identity');
    expect(result.creditedKill?.shipCreditResolved).toBe(false);
  });

  test('does not mutate the event or parent contexts', () => {
    const event = navalKillEvent({
      attributions: [primaryAttribution(), unresolvedAttribution()],
    });
    const contexts = [killerParentContext()];
    const eventBefore = JSON.parse(JSON.stringify(event)) as NavalLossEvent;
    const contextsBefore = JSON.parse(
      JSON.stringify(contexts),
    ) as NavalLossParentContext[];

    resolveCreditedNavalKill(event, contexts);

    expect(event).toEqual(eventBefore);
    expect(contexts).toEqual(contextsBefore);
  });

  test('is deterministic across repeated resolution', () => {
    const event = navalKillEvent({
      attributions: [primaryAttribution(), unresolvedAttribution()],
    });
    const contexts = [killerParentContext()];

    expect(resolveCreditedNavalKill(event, contexts)).toEqual(
      resolveCreditedNavalKill(event, contexts),
    );
  });
});
