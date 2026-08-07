import type { NavalLossEvent } from '../naval-loss.types';

export interface NavalLossEventFixtureOverrides extends Omit<
  Partial<NavalLossEvent>,
  'sunkShip' | 'event' | 'sourceSummary'
> {
  sunkShip?: Partial<NavalLossEvent['sunkShip']>;
  event?: Partial<NavalLossEvent['event']>;
  sourceSummary?: Partial<NavalLossEvent['sourceSummary']>;
}

export function navalLossEvent(
  overrides: NavalLossEventFixtureOverrides = {},
): NavalLossEvent {
  return {
    eventId: overrides.eventId ?? 'event-1',
    rawRecordCount: overrides.rawRecordCount ?? 1,
    confidence: overrides.confidence ?? 'high',
    deduplicationStatus: overrides.deduplicationStatus ?? 'global_anchor',
    countable: overrides.countable ?? true,
    ambiguityReasons: overrides.ambiguityReasons
      ? [...overrides.ambiguityReasons]
      : [],
    sunkShip: {
      name: 'HMS Example',
      countryTag: 'ENG',
      definition: 'destroyer',
      level: 2,
      equipmentVariant: { id: 101, type: 70, status: 'valid' },
      ...overrides.sunkShip,
    },
    event: {
      date: '1942.6.1.12',
      location: 42,
      battle: { id: 201, type: 4713, status: 'valid' },
      convoyRelated: false,
      ...overrides.event,
    },
    attributions: overrides.attributions
      ? overrides.attributions.map((attribution) => ({
          ...attribution,
          sourceRecordIds: [...attribution.sourceRecordIds],
        }))
      : [
          {
            role: 'primary_observed',
            killerName: 'KMS Example',
            killerCountryTag: 'GER',
            killerDefinition: 'submarine',
            sourceRecordIds: ['global_history:100:0'],
            parentContextId: null,
          },
        ],
    sourceSummary: {
      hasGlobalHistoryRecord: true,
      hasShipHistoryRecord: false,
      globalHistoryRecords: 1,
      shipHistoryRecords: 0,
      ...overrides.sourceSummary,
    },
    sourceRecordIds: overrides.sourceRecordIds
      ? [...overrides.sourceRecordIds]
      : ['global_history:100:0'],
  };
}
