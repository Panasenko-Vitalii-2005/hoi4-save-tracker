import type {
  NavalLossParentContext,
  ParsedNavalLoss,
} from '../naval-loss.types';

export interface NavalLossFixtureOverrides extends Omit<
  Partial<ParsedNavalLoss>,
  'sunkShip' | 'attribution' | 'event'
> {
  sunkShip?: Partial<ParsedNavalLoss['sunkShip']>;
  attribution?: Partial<ParsedNavalLoss['attribution']>;
  event?: Partial<ParsedNavalLoss['event']>;
}

export function navalLossRecord(
  overrides: NavalLossFixtureOverrides = {},
): ParsedNavalLoss {
  const source = overrides.source ?? 'global_history';
  const sourceOffset = overrides.sourceOffset ?? 100;
  const ordinal = overrides.ordinal ?? 0;
  return {
    recordId: overrides.recordId ?? `${source}:${sourceOffset}:${ordinal}`,
    source,
    sourceOffset,
    sourcePath:
      overrides.sourcePath ??
      (source === 'global_history'
        ? 'history.sunk_ship'
        : 'countries.TAG.fleet.task_force.ship.history.army_history.history_queue.sunk_ship'),
    ordinal,
    complete: overrides.complete ?? true,
    warnings: overrides.warnings ? [...overrides.warnings] : [],
    sunkShip: {
      name: 'U-144',
      countryTag: 'GER',
      definition: 'submarine',
      level: 3,
      equipmentVariant: { id: 6032, type: 70, status: 'valid' },
      ...overrides.sunkShip,
    },
    attribution: {
      killerName: 'HMS Napier',
      killerCountryTag: 'ENG',
      killerDefinition: 'destroyer',
      assist: null,
      ...overrides.attribution,
    },
    event: {
      date: '1943.9.28.21',
      location: 8522,
      battle: { id: 124995, type: 4713, status: 'valid' },
      convoyRelated: false,
      ...overrides.event,
    },
    parentContextId: overrides.parentContextId ?? null,
  };
}

export function shipHistoryRecord(
  overrides: NavalLossFixtureOverrides = {},
): ParsedNavalLoss {
  return navalLossRecord({
    source: 'ship_history',
    sourceOffset: 200,
    ordinal: 0,
    parentContextId: 'context-1',
    ...overrides,
  });
}

export function navalLossParentContext(
  overrides: Partial<NavalLossParentContext> = {},
): NavalLossParentContext {
  return {
    contextId: 'context-1',
    countryTag: 'ENG',
    fleetId: { id: 11, type: 61, status: 'valid' },
    taskForceId: { id: 22, type: 61, status: 'valid' },
    shipId: { id: 33, type: 51, status: 'valid' },
    shipName: 'HMS Napier',
    shipDefinition: 'destroyer',
    ...overrides,
  };
}
