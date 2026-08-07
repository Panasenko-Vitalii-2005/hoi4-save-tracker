import type {
  NavalLossAnalyzeResultDto,
  NavalLossEventDetailsDto,
  NavalLossEventPageDto,
  NavalRemovalMarkerPageDto,
} from './naval-loss.dto';
import type {
  NavalLossAnalysis,
  NavalLossEvent,
  NavalLossParentContext,
  ParsedNavalLoss,
  ParsedNavalRemovalMarker,
} from './naval-loss.types';

describe('naval loss contracts', () => {
  const validId = { id: 12, type: 70, status: 'valid' } as const;

  const parentContext: NavalLossParentContext = {
    contextId: 'context-1',
    countryTag: 'ENG',
    fleetId: { id: 1, type: 61, status: 'valid' },
    taskForceId: { id: 2, type: 61, status: 'valid' },
    shipId: { id: 3, type: 51, status: 'valid' },
    shipName: 'HMS Example',
    shipDefinition: 'destroyer',
  };

  const rawRecord: ParsedNavalLoss = {
    recordId: 'record-1',
    source: 'global_history',
    sourceOffset: 100,
    sourcePath: 'history.sunk_ship',
    ordinal: 0,
    complete: true,
    warnings: [],
    sunkShip: {
      name: 'U-1',
      countryTag: 'GER',
      definition: 'submarine',
      level: 1,
      equipmentVariant: validId,
    },
    attribution: {
      killerName: 'HMS Example',
      killerCountryTag: 'ENG',
      killerDefinition: 'destroyer',
      assist: false,
    },
    event: {
      date: '1940.1.1.1',
      location: 123,
      battle: { id: 4, type: 4713, status: 'valid' },
      convoyRelated: false,
    },
    parentContextId: null,
  };

  const event: NavalLossEvent = {
    eventId: 'event-1',
    rawRecordCount: 1,
    confidence: 'high',
    deduplicationStatus: 'global_anchor',
    countable: true,
    ambiguityReasons: [],
    sunkShip: rawRecord.sunkShip,
    event: rawRecord.event,
    attributions: [
      {
        role: 'primary_observed',
        killerName: 'HMS Example',
        killerCountryTag: 'ENG',
        killerDefinition: 'destroyer',
        sourceRecordIds: ['record-1'],
        parentContextId: null,
      },
    ],
    sourceSummary: {
      hasGlobalHistoryRecord: true,
      hasShipHistoryRecord: false,
      globalHistoryRecords: 1,
      shipHistoryRecords: 0,
    },
    sourceRecordIds: ['record-1'],
  };

  const marker: ParsedNavalRemovalMarker = {
    markerId: 'marker-1',
    sourceOffset: 200,
    ordinal: 0,
    countryTag: 'GER',
    type: 1,
    name: 'U-1',
    nameOrder: null,
    isNameOrdered: null,
    overrideSetProgrammatically: true,
    equipmentVariant: validId,
    equipmentResolution: {
      status: 'resolved',
      definition: 'submarine',
      variantName: 'Example Submarine',
      candidateDefinitions: ['submarine'],
    },
    warnings: [],
  };

  const summary = {
    countableDetailedEvents: 1,
    ambiguousDetailedGroups: 0,
    globalAnchorEvents: 1,
    shipHistoryOnlyEvents: 0,
    rawDetailedRecords: 1,
    removalMarkers: 1,
    namedRemovalMarkers: 1,
    unnamedRemovalMarkers: 0,
    detailedEventsByType: { submarine: 1 },
    removalMarkersByResolvedType: { submarine: 1 },
    warnings: [],
  };

  const methodology = {
    schemaVersion: '1',
    deduplicationVersion: '1',
    completeCampaignHistoryAvailable: false,
    detailedEventsAndRemovalMarkersAreAdditive: false,
    warnings: [],
  } as const;

  test('compact analysis DTO serializes without internal records', () => {
    const dto: NavalLossAnalyzeResultDto = {
      summary,
      byCountry: [{ countryTag: 'GER', ...summary }],
      methodology,
      detailAvailability: {
        events: 1,
        removalMarkers: 1,
        rawRecords: 1,
      },
    };

    const serialized = JSON.parse(JSON.stringify(dto)) as Record<
      string,
      unknown
    >;

    expect(serialized).not.toHaveProperty('rawDetailedRecords');
    expect(serialized).not.toHaveProperty('detailedEvents');
    expect(serialized).not.toHaveProperty('removalMarkers');
  });

  test('detail and internal contracts preserve provenance', () => {
    const eventPage: NavalLossEventPageDto = {
      items: [event],
      nextCursor: null,
      total: 1,
    };
    const markerPage: NavalRemovalMarkerPageDto = {
      items: [marker],
      nextCursor: null,
      total: 1,
    };
    const details: NavalLossEventDetailsDto = {
      event,
      sourceRecords: [rawRecord],
      parentContexts: [parentContext],
    };
    const analysis: NavalLossAnalysis = {
      rawDetailedRecords: [rawRecord],
      parentContexts: [parentContext],
      detailedEvents: [event],
      removalMarkers: [marker],
      ambiguities: [
        {
          ambiguityId: 'ambiguity-1',
          reason: 'example',
          sourceRecordIds: ['record-1'],
        },
      ],
      byCountry: [{ countryTag: 'GER', ...summary }],
      summary,
      methodology,
    };

    expect(eventPage.items[0].sourceRecordIds).toEqual(['record-1']);
    expect(markerPage.items[0].markerId).toBe('marker-1');
    expect(details.parentContexts[0].shipId).toEqual(parentContext.shipId);
    expect(analysis.ambiguities).toHaveLength(1);
  });
});
