export interface SaveScopedId {
  id: number | null;
  type: number | null;
  status: 'valid' | 'zero_sentinel' | 'incomplete';
}

export type NavalLossRecordSource = 'global_history' | 'ship_history';

export type NavalLossAttributionRole =
  'primary_observed' | 'assistant' | 'alternative' | 'unresolved';

export type NavalLossConfidence = 'high' | 'medium' | 'low';

export type NavalLossDeduplicationStatus =
  'global_anchor' | 'matched_to_global' | 'ship_history_only' | 'ambiguous';

export interface NavalLossParentContext {
  contextId: string;
  countryTag: string | null;
  fleetId: SaveScopedId | null;
  taskForceId: SaveScopedId | null;
  shipId: SaveScopedId | null;
  shipName: string | null;
  shipDefinition: string | null;
}

export interface ParsedNavalLoss {
  recordId: string;
  source: NavalLossRecordSource;
  sourceOffset: number;
  sourcePath: string;
  ordinal: number;
  complete: boolean;
  warnings: string[];
  sunkShip: {
    name: string | null;
    countryTag: string | null;
    definition: string | null;
    level: number | null;
    equipmentVariant: SaveScopedId | null;
  };
  attribution: {
    killerName: string | null;
    killerCountryTag: string | null;
    killerDefinition: string | null;
    assist: boolean | null;
  };
  event: {
    date: string | null;
    location: number | null;
    battle: SaveScopedId | null;
    convoyRelated: boolean | null;
  };
  parentContextId: string | null;
}

export interface NavalLossAttribution {
  role: NavalLossAttributionRole;
  killerName: string | null;
  killerCountryTag: string | null;
  killerDefinition: string | null;
  sourceRecordIds: string[];
  parentContextId: string | null;
}

export interface NavalLossSourceSummary {
  hasGlobalHistoryRecord: boolean;
  hasShipHistoryRecord: boolean;
  globalHistoryRecords: number;
  shipHistoryRecords: number;
}

export interface NavalLossEvent {
  eventId: string;
  rawRecordCount: number;
  confidence: NavalLossConfidence;
  deduplicationStatus: NavalLossDeduplicationStatus;
  countable: boolean;
  ambiguityReasons: string[];
  sunkShip: ParsedNavalLoss['sunkShip'];
  event: ParsedNavalLoss['event'];
  attributions: NavalLossAttribution[];
  sourceSummary: NavalLossSourceSummary;
  sourceRecordIds: string[];
}

export interface NavalLossAmbiguity {
  ambiguityId: string;
  reason: string;
  sourceRecordIds: string[];
}

export interface NavalEquipmentResolution {
  status: 'resolved' | 'unresolved' | 'conflicting';
  definition: string | null;
  variantName: string | null;
  candidateDefinitions: string[];
}

export interface ParsedNavalRemovalMarker {
  markerId: string;
  sourceOffset: number;
  ordinal: number;
  countryTag: string | null;
  type: number;
  name: string | null;
  nameOrder: number | null;
  isNameOrdered: boolean | null;
  overrideSetProgrammatically: boolean | null;
  equipmentVariant: SaveScopedId | null;
  equipmentResolution: NavalEquipmentResolution;
  warnings: string[];
}

export interface CountryNavalSummary {
  countryTag: string;
  countableDetailedEvents: number;
  ambiguousDetailedGroups: number;
  globalAnchorEvents: number;
  shipHistoryOnlyEvents: number;
  rawDetailedRecords: number;
  removalMarkers: number;
  namedRemovalMarkers: number;
  unnamedRemovalMarkers: number;
  detailedEventsByType: Record<string, number>;
  removalMarkersByResolvedType: Record<string, number>;
  warnings: string[];
}

export interface NavalLossSummary {
  countableDetailedEvents: number;
  ambiguousDetailedGroups: number;
  globalAnchorEvents: number;
  shipHistoryOnlyEvents: number;
  rawDetailedRecords: number;
  removalMarkers: number;
  namedRemovalMarkers: number;
  unnamedRemovalMarkers: number;
  detailedEventsByType: Record<string, number>;
  removalMarkersByResolvedType: Record<string, number>;
  warnings: string[];
}

export interface NavalLossMethodology {
  schemaVersion: string;
  deduplicationVersion: string;
  completeCampaignHistoryAvailable: false;
  detailedEventsAndRemovalMarkersAreAdditive: false;
  warnings: string[];
}

export interface NavalLossAnalysis {
  rawDetailedRecords: ParsedNavalLoss[];
  parentContexts: NavalLossParentContext[];
  detailedEvents: NavalLossEvent[];
  removalMarkers: ParsedNavalRemovalMarker[];
  ambiguities: NavalLossAmbiguity[];
  byCountry: CountryNavalSummary[];
  summary: NavalLossSummary;
  methodology: NavalLossMethodology;
}
