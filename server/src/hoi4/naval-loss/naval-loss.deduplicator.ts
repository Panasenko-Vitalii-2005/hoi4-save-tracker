import type {
  NavalLossAttribution,
  NavalLossConfidence,
  NavalLossDeduplicationStatus,
  NavalLossEvent,
  NavalLossParentContext,
  ParsedNavalLoss,
  SaveScopedId,
} from './naval-loss.types';

interface IndexedRecord {
  record: ParsedNavalLoss;
  inputIndex: number;
}

interface MatchKey {
  key: string;
  tier: 'high' | 'medium';
  emptyName: boolean;
}

interface EventCluster {
  records: IndexedRecord[];
  globalRecords: number;
  shipHistoryRecords: number;
  matchTier: 'none' | 'medium' | 'high';
  ambiguousIdentity: boolean;
  ambiguityReasons: string[];
  identity: IdentityEvidence;
}

interface IdentityEvidence {
  battle: string | null;
  equipment: string | null;
  location: number | null;
  level: number | null;
  convoyRelated: boolean | null;
}

type IndexEntry = number | 'ambiguous';

function normalizeText(value: string | null): string | null {
  return value === null ? null : value.trim();
}

function nonEmptyText(value: string | null): string | null {
  const normalized = normalizeText(value);
  return normalized ? normalized : null;
}

function strongId(id: SaveScopedId | null): string | null {
  if (
    id?.status !== 'valid' ||
    id.id === null ||
    id.type === null ||
    id.id === 0 ||
    id.type === 0
  ) {
    return null;
  }
  return `${id.id}:${id.type}`;
}

function occurrenceOrder(left: IndexedRecord, right: IndexedRecord): number {
  return (
    left.record.sourceOffset - right.record.sourceOffset ||
    left.inputIndex - right.inputIndex
  );
}

function processingOrder(left: IndexedRecord, right: IndexedRecord): number {
  const leftSource = left.record.source === 'global_history' ? 0 : 1;
  const rightSource = right.record.source === 'global_history' ? 0 : 1;
  return leftSource - rightSource || occurrenceOrder(left, right);
}

function parentKillerTokens(
  record: ParsedNavalLoss,
  contexts: ReadonlyMap<string, NavalLossParentContext>,
): string[] {
  if (record.parentContextId === null) return [];
  const parent = contexts.get(record.parentContextId);
  if (!parent) return [];

  const country = nonEmptyText(parent.countryTag);
  if (!country) return [];

  const tokens: string[] = [];
  const shipId = strongId(parent.shipId);
  if (shipId) tokens.push(JSON.stringify(['parent-id', country, shipId]));

  const shipName = nonEmptyText(parent.shipName);
  const definition = nonEmptyText(parent.shipDefinition);
  if (shipName && definition) {
    tokens.push(JSON.stringify(['killer-name', country, shipName]));
  }
  return tokens;
}

function killerTokens(
  record: ParsedNavalLoss,
  contexts: ReadonlyMap<string, NavalLossParentContext>,
): string[] {
  const tokens = new Set(parentKillerTokens(record, contexts));
  const country = nonEmptyText(record.attribution.killerCountryTag);
  const name = nonEmptyText(record.attribution.killerName);
  if (country && name) {
    tokens.add(JSON.stringify(['killer-name', country, name]));
  }
  return [...tokens];
}

function identityEvidence(record: ParsedNavalLoss): IdentityEvidence {
  return {
    battle: strongId(record.event.battle),
    equipment: strongId(record.sunkShip.equipmentVariant),
    location: record.event.location,
    level: record.sunkShip.level,
    convoyRelated: record.event.convoyRelated,
  };
}

function hasIdentityConflict(
  cluster: EventCluster,
  record: ParsedNavalLoss,
  tier: MatchKey['tier'],
): boolean {
  const incoming = identityEvidence(record);
  const fields: (keyof IdentityEvidence)[] =
    tier === 'high'
      ? ['equipment']
      : ['battle', 'equipment', 'location', 'level', 'convoyRelated'];
  return fields.some(
    (key) =>
      cluster.identity[key] !== null &&
      incoming[key] !== null &&
      cluster.identity[key] !== incoming[key],
  );
}

function mergeIdentityEvidence(
  target: IdentityEvidence,
  record: ParsedNavalLoss,
): void {
  const incoming = identityEvidence(record);
  for (const key of Object.keys(incoming) as (keyof IdentityEvidence)[]) {
    if (target[key] === null && incoming[key] !== null) {
      target[key] = incoming[key] as never;
    }
  }
}

function matchKeys(
  record: ParsedNavalLoss,
  contexts: ReadonlyMap<string, NavalLossParentContext>,
): MatchKey[] {
  const country = nonEmptyText(record.sunkShip.countryTag);
  const name = normalizeText(record.sunkShip.name);
  const date = nonEmptyText(record.event.date);
  const definition = nonEmptyText(record.sunkShip.definition);
  if (!country || name === null || !date || !definition) return [];

  const battle = strongId(record.event.battle);
  const equipment = strongId(record.sunkShip.equipmentVariant);

  if (name === '') {
    if (!battle || !equipment || record.event.location === null) return [];
    return [
      {
        key: JSON.stringify([
          'empty-high',
          country,
          date,
          definition,
          battle,
          equipment,
          record.event.location,
        ]),
        tier: 'high',
        emptyName: true,
      },
    ];
  }

  const keys: MatchKey[] = [];
  if (battle) {
    keys.push({
      key: JSON.stringify([
        'named-high',
        country,
        name,
        date,
        definition,
        battle,
        equipment,
      ]),
      tier: 'high',
      emptyName: false,
    });
  }

  if (record.event.location !== null) {
    for (const killer of killerTokens(record, contexts)) {
      keys.push({
        key: JSON.stringify([
          'named-medium',
          country,
          name,
          date,
          definition,
          record.event.location,
          killer,
        ]),
        tier: 'medium',
        emptyName: false,
      });
    }
  }
  return keys;
}

function mayMergeEmptyName(
  cluster: EventCluster,
  record: ParsedNavalLoss,
): boolean {
  return record.source === 'ship_history' && cluster.globalRecords > 0;
}

function registerKeys(
  index: Map<string, IndexEntry>,
  keys: readonly MatchKey[],
  clusterIndex: number,
): void {
  for (const { key } of keys) {
    const existing = index.get(key);
    if (existing === undefined || existing === clusterIndex) {
      index.set(key, clusterIndex);
    } else {
      index.set(key, 'ambiguous');
    }
  }
}

function strongerTier(
  current: EventCluster['matchTier'],
  incoming: MatchKey['tier'],
): EventCluster['matchTier'] {
  if (current === 'high' || incoming === 'high') return 'high';
  return 'medium';
}

function addRecord(
  clusters: EventCluster[],
  index: Map<string, IndexEntry>,
  entry: IndexedRecord,
  keys: readonly MatchKey[],
): void {
  let candidate: number | undefined;
  let candidateTier: MatchKey['tier'] = 'medium';
  let ambiguousCandidate = false;

  for (const tier of ['high', 'medium'] as const) {
    let tierCandidate: number | undefined;
    let tierAmbiguous = false;
    let tierHasIndexEntry = false;
    for (const matchKey of keys) {
      if (matchKey.tier !== tier) continue;
      const indexed = index.get(matchKey.key);
      if (indexed === undefined) continue;
      tierHasIndexEntry = true;
      if (indexed === 'ambiguous') {
        tierAmbiguous = true;
      } else if (tierCandidate !== undefined && tierCandidate !== indexed) {
        tierAmbiguous = true;
      } else {
        tierCandidate = indexed;
      }
    }
    if (tierHasIndexEntry) {
      candidate = tierCandidate;
      candidateTier = tier;
      ambiguousCandidate = tierAmbiguous;
      break;
    }
  }

  const emptyName = keys.some((key) => key.emptyName);
  const sourceAllowsMerge =
    candidate === undefined ||
    !emptyName ||
    mayMergeEmptyName(clusters[candidate], entry.record);
  const identityAllowsMerge =
    candidate === undefined ||
    !hasIdentityConflict(clusters[candidate], entry.record, candidateTier);

  if (
    candidate !== undefined &&
    !ambiguousCandidate &&
    sourceAllowsMerge &&
    identityAllowsMerge
  ) {
    const cluster = clusters[candidate];
    cluster.records.push(entry);
    if (entry.record.source === 'global_history') cluster.globalRecords++;
    else cluster.shipHistoryRecords++;
    cluster.matchTier = strongerTier(cluster.matchTier, candidateTier);
    mergeIdentityEvidence(cluster.identity, entry.record);
    registerKeys(index, keys, candidate);
    return;
  }

  const reasons: string[] = [];
  if (ambiguousCandidate) {
    reasons.push(
      `multiple candidate events for source record ${entry.record.recordId}`,
    );
  } else if (candidate !== undefined && emptyName && !sourceAllowsMerge) {
    reasons.push(
      `empty-name identity is not unique within source ${entry.record.source}`,
    );
  }

  const clusterIndex = clusters.length;
  clusters.push({
    records: [entry],
    globalRecords: Number(entry.record.source === 'global_history'),
    shipHistoryRecords: Number(entry.record.source === 'ship_history'),
    matchTier: 'none',
    ambiguousIdentity: reasons.length > 0,
    ambiguityReasons: reasons,
    identity: identityEvidence(entry.record),
  });
  registerKeys(index, keys, clusterIndex);
}

function cloneId(id: SaveScopedId | null): SaveScopedId | null {
  return id === null ? null : { ...id };
}

function preferredRecords(records: readonly IndexedRecord[]): IndexedRecord[] {
  return [...records].sort((left, right) => {
    const sourceOrder =
      (left.record.source === 'global_history' ? 0 : 1) -
      (right.record.source === 'global_history' ? 0 : 1);
    const completenessOrder =
      Number(right.record.complete) - Number(left.record.complete);
    return sourceOrder || completenessOrder || occurrenceOrder(left, right);
  });
}

function firstKnown<T>(
  records: readonly IndexedRecord[],
  read: (record: ParsedNavalLoss) => T | null,
): T | null {
  for (const entry of records) {
    const value = read(entry.record);
    if (value !== null) return value;
  }
  return null;
}

function preferredId(
  records: readonly IndexedRecord[],
  read: (record: ParsedNavalLoss) => SaveScopedId | null,
): SaveScopedId | null {
  const ids = records.map((entry) => read(entry.record));
  return cloneId(
    ids.find((id) => strongId(id) !== null) ?? ids.find(Boolean) ?? null,
  );
}

function attributionRole(
  record: ParsedNavalLoss,
): NavalLossAttribution['role'] {
  if (record.attribution.assist === true) return 'assistant';
  if (
    record.source === 'global_history' ||
    record.attribution.assist === false
  ) {
    return 'primary_observed';
  }
  return 'unresolved';
}

function buildAttributions(
  records: readonly IndexedRecord[],
): NavalLossAttribution[] {
  const attributions = new Map<string, NavalLossAttribution>();
  for (const { record } of [...records].sort(occurrenceOrder)) {
    const role = attributionRole(record);
    const key = JSON.stringify([
      role,
      record.attribution.killerName,
      record.attribution.killerCountryTag,
      record.attribution.killerDefinition,
      record.parentContextId,
    ]);
    const existing = attributions.get(key);
    if (existing) {
      existing.sourceRecordIds.push(record.recordId);
    } else {
      attributions.set(key, {
        role,
        killerName: record.attribution.killerName,
        killerCountryTag: record.attribution.killerCountryTag,
        killerDefinition: record.attribution.killerDefinition,
        sourceRecordIds: [record.recordId],
        parentContextId: record.parentContextId,
      });
    }
  }
  return [...attributions.values()];
}

function primaryKillerConflict(
  attributions: readonly NavalLossAttribution[],
): boolean {
  const observed = new Set<string>();
  for (const attribution of attributions) {
    if (attribution.role === 'assistant') continue;
    if (
      attribution.killerName === null &&
      attribution.killerCountryTag === null &&
      attribution.killerDefinition === null
    ) {
      continue;
    }
    observed.add(
      JSON.stringify([
        attribution.killerName,
        attribution.killerCountryTag,
        attribution.killerDefinition,
      ]),
    );
  }
  return observed.size > 1;
}

function fieldConflictReasons(records: readonly IndexedRecord[]): string[] {
  const fields: Array<{
    label: string;
    read: (record: ParsedNavalLoss) => string | number | boolean | null;
  }> = [
    {
      label: 'sunkShip.name',
      read: (record) => normalizeText(record.sunkShip.name),
    },
    {
      label: 'sunkShip.countryTag',
      read: (record) => normalizeText(record.sunkShip.countryTag),
    },
    {
      label: 'sunkShip.definition',
      read: (record) => normalizeText(record.sunkShip.definition),
    },
    { label: 'sunkShip.level', read: (record) => record.sunkShip.level },
    {
      label: 'sunkShip.equipmentVariant',
      read: (record) => strongId(record.sunkShip.equipmentVariant),
    },
    {
      label: 'event.date',
      read: (record) => normalizeText(record.event.date),
    },
    { label: 'event.location', read: (record) => record.event.location },
    {
      label: 'event.battle',
      read: (record) => strongId(record.event.battle),
    },
    {
      label: 'event.convoyRelated',
      read: (record) => record.event.convoyRelated,
    },
  ];

  const reasons: string[] = [];
  for (const { label, read } of fields) {
    const values = new Set<string>();
    for (const { record } of records) {
      const value = read(record);
      if (value !== null) values.add(JSON.stringify(value));
    }
    if (values.size > 1) {
      reasons.push(`conflicting ${label} values: ${[...values].join(', ')}`);
    }
  }
  return reasons;
}

function deduplicationStatus(
  cluster: EventCluster,
  globalRecords: number,
  shipHistoryRecords: number,
): NavalLossDeduplicationStatus {
  if (
    cluster.ambiguousIdentity ||
    cluster.records.every(({ record }) => !record.complete)
  ) {
    return 'ambiguous';
  }
  if (globalRecords > 0 && shipHistoryRecords > 0) return 'matched_to_global';
  return globalRecords > 0 ? 'global_anchor' : 'ship_history_only';
}

function confidence(
  status: NavalLossDeduplicationStatus,
  matchTier: EventCluster['matchTier'],
  killerConflict: boolean,
): NavalLossConfidence {
  if (status === 'ambiguous') return 'low';
  if (killerConflict || matchTier === 'medium') return 'medium';
  if (status === 'ship_history_only' && matchTier === 'none') return 'medium';
  return 'high';
}

function buildEvent(cluster: EventCluster): {
  event: NavalLossEvent;
  earliest: IndexedRecord;
} {
  const ordered = [...cluster.records].sort(occurrenceOrder);
  const preferred = preferredRecords(cluster.records);
  const { globalRecords, shipHistoryRecords } = cluster;
  const attributions = buildAttributions(ordered);
  const killerConflict = primaryKillerConflict(attributions);
  const fieldConflicts = fieldConflictReasons(ordered);
  const ambiguityReasons = [...cluster.ambiguityReasons];

  for (const { record } of ordered) {
    if (!record.complete && record.warnings.length === 0) {
      ambiguityReasons.push(`incomplete source record ${record.recordId}`);
    }
    for (const warning of record.warnings) {
      ambiguityReasons.push(`${record.recordId}: ${warning}`);
    }
  }
  if (killerConflict)
    ambiguityReasons.push('conflicting primary killer attribution');
  ambiguityReasons.push(...fieldConflicts);

  const status = deduplicationStatus(
    cluster,
    globalRecords,
    shipHistoryRecords,
  );
  return {
    earliest: ordered[0],
    event: {
      eventId: `naval_loss:${ordered[0].record.recordId}:${ordered[0].inputIndex}`,
      rawRecordCount: ordered.length,
      confidence: confidence(
        status,
        cluster.matchTier,
        killerConflict || fieldConflicts.length > 0,
      ),
      deduplicationStatus: status,
      countable:
        !cluster.ambiguousIdentity &&
        ordered.some(({ record }) => record.complete),
      ambiguityReasons,
      sunkShip: {
        name: firstKnown(preferred, (record) => record.sunkShip.name),
        countryTag: firstKnown(
          preferred,
          (record) => record.sunkShip.countryTag,
        ),
        definition: firstKnown(
          preferred,
          (record) => record.sunkShip.definition,
        ),
        level: firstKnown(preferred, (record) => record.sunkShip.level),
        equipmentVariant: preferredId(
          preferred,
          (record) => record.sunkShip.equipmentVariant,
        ),
      },
      event: {
        date: firstKnown(preferred, (record) => record.event.date),
        location: firstKnown(preferred, (record) => record.event.location),
        battle: preferredId(preferred, (record) => record.event.battle),
        convoyRelated: firstKnown(
          preferred,
          (record) => record.event.convoyRelated,
        ),
      },
      attributions,
      sourceSummary: {
        hasGlobalHistoryRecord: globalRecords > 0,
        hasShipHistoryRecord: shipHistoryRecords > 0,
        globalHistoryRecords: globalRecords,
        shipHistoryRecords,
      },
      sourceRecordIds: ordered.map(({ record }) => record.recordId),
    },
  };
}

/**
 * Uses a constant number of conservative identity keys per record. Indexing is
 * O(n), while stable input/event ordering makes total expected time O(n log n)
 * and memory O(n); no all-record pairwise comparison is performed.
 */
export function deduplicateNavalLosses(
  records: readonly ParsedNavalLoss[],
  parentContexts: readonly NavalLossParentContext[] = [],
): NavalLossEvent[] {
  const contexts = new Map(
    parentContexts.map((context) => [context.contextId, context]),
  );
  const indexedRecords = records.map((record, inputIndex) => ({
    record,
    inputIndex,
  }));
  const clusters: EventCluster[] = [];
  const index = new Map<string, IndexEntry>();

  for (const entry of [...indexedRecords].sort(processingOrder)) {
    const keys = matchKeys(entry.record, contexts);
    addRecord(clusters, index, entry, keys);
  }

  return clusters
    .map(buildEvent)
    .sort((left, right) => occurrenceOrder(left.earliest, right.earliest))
    .map((result) => result.event);
}
