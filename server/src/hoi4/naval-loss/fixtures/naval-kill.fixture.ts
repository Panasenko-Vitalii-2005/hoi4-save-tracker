import { navalLossEvent } from './aggregation.fixture';
import type {
  CreditedNavalKill,
  NavalLossAttribution,
  NavalLossEvent,
  NavalLossParentContext,
} from '../naval-loss.types';

export function primaryAttribution(
  overrides: Partial<NavalLossAttribution> = {},
): NavalLossAttribution {
  return {
    role: 'primary_observed',
    killerName: 'KMS Example',
    killerCountryTag: 'GER',
    killerDefinition: 'submarine',
    sourceRecordIds: ['global_history:100:0'],
    parentContextId: null,
    ...overrides,
  };
}

export function assistantAttribution(
  overrides: Partial<NavalLossAttribution> = {},
): NavalLossAttribution {
  return primaryAttribution({
    role: 'assistant',
    killerName: 'Assistant Ship',
    killerCountryTag: 'ITA',
    parentContextId: 'assistant-context',
    ...overrides,
  });
}

export function unresolvedAttribution(
  overrides: Partial<NavalLossAttribution> = {},
): NavalLossAttribution {
  return primaryAttribution({
    role: 'unresolved',
    parentContextId: 'killer-context',
    ...overrides,
  });
}

export function navalKillEvent(
  overrides: Parameters<typeof navalLossEvent>[0] = {},
): NavalLossEvent {
  return navalLossEvent(overrides);
}

export function killerParentContext(
  overrides: Partial<NavalLossParentContext> = {},
): NavalLossParentContext {
  return {
    contextId: 'killer-context',
    countryTag: 'GER',
    fleetId: { id: 11, type: 61, status: 'valid' },
    taskForceId: { id: 22, type: 61, status: 'valid' },
    shipId: { id: 33, type: 51, status: 'valid' },
    shipName: 'KMS Example',
    shipDefinition: 'submarine',
    ...overrides,
  };
}

export interface CreditedKillOverrides extends Omit<
  Partial<CreditedNavalKill>,
  'sunkShip' | 'event' | 'killerShip'
> {
  sunkShip?: Partial<CreditedNavalKill['sunkShip']>;
  event?: Partial<CreditedNavalKill['event']>;
  killerShip?: Partial<NonNullable<CreditedNavalKill['killerShip']>> | null;
}

export function creditedNavalKill(
  overrides: CreditedKillOverrides = {},
): CreditedNavalKill {
  const defaultKillerShip: NonNullable<CreditedNavalKill['killerShip']> = {
    name: 'KMS Example',
    definition: 'submarine',
    identity: { id: 33, type: 51 },
  };
  const killerShip =
    overrides.killerShip === null
      ? null
      : { ...defaultKillerShip, ...overrides.killerShip };
  return {
    eventId: overrides.eventId ?? 'event-1',
    sunkShip: {
      countryTag: 'ENG',
      name: 'HMS Example',
      definition: 'destroyer',
      ...overrides.sunkShip,
    },
    event: { date: '1942.6.1.12', ...overrides.event },
    killerCountryTag: overrides.killerCountryTag ?? 'GER',
    killerShip,
    shipCreditResolved:
      overrides.shipCreditResolved ??
      (killerShip !== null && killerShip.identity !== null),
  };
}
