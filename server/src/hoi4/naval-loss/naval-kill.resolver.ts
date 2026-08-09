import type {
  CreditedKillerShip,
  CreditedNavalKill,
  NavalLossAttribution,
  NavalLossEvent,
  NavalLossParentContext,
  SaveScopedId,
} from './naval-loss.types';

export type NavalKillCountryResolution =
  | 'credited'
  | 'no_primary_attribution'
  | 'missing_killer_country'
  | 'conflicting_killer_countries';

export type NavalKillShipResolution =
  | 'resolved'
  | 'missing_safe_identity'
  | 'conflicting_killer_ships'
  | 'not_applicable';

export interface NavalKillResolution {
  eventId: string;
  countryResolution: NavalKillCountryResolution;
  shipResolution: NavalKillShipResolution;
  creditedKill: CreditedNavalKill | null;
}

function normalized(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function strongShipId(
  id: SaveScopedId | null,
): { id: number; type: number } | null {
  if (
    id?.status !== 'valid' ||
    id.id === null ||
    id.type === null ||
    id.id === 0 ||
    id.type === 0
  ) {
    return null;
  }
  return { id: id.id, type: id.type };
}

function uniqueKnown(values: readonly (string | null)[]): {
  value: string | null;
  conflicting: boolean;
} {
  const known = new Set(values.map(normalized).filter((value) => value));
  return {
    value: known.size === 1 ? [...known][0] : null,
    conflicting: known.size > 1,
  };
}

function matchingCountry(
  attribution: NavalLossAttribution,
  countryTag: string,
): boolean {
  return normalized(attribution.killerCountryTag) === countryTag;
}

interface SafeShipCandidate {
  key: string;
  identity: { id: number; type: number };
  name: string | null;
  definition: string | null;
}

function safeShipCandidate(
  attribution: NavalLossAttribution,
  countryTag: string,
  canonicalName: string | null,
  canonicalDefinition: string | null,
  contexts: ReadonlyMap<string, NavalLossParentContext>,
): { candidate: SafeShipCandidate | null; conflicting: boolean } {
  if (attribution.parentContextId === null) {
    return { candidate: null, conflicting: false };
  }
  const context = contexts.get(attribution.parentContextId);
  const identity = strongShipId(context?.shipId ?? null);
  if (!context || !identity || normalized(context.countryTag) !== countryTag) {
    return { candidate: null, conflicting: false };
  }

  const attributionName = normalized(attribution.killerName);
  const attributionDefinition = normalized(attribution.killerDefinition);
  const contextName = normalized(context.shipName);
  const contextDefinition = normalized(context.shipDefinition);
  const nameConflict =
    (attributionName !== null &&
      contextName !== null &&
      attributionName !== contextName) ||
    (canonicalName !== null &&
      contextName !== null &&
      canonicalName !== contextName);
  const definitionConflict =
    (attributionDefinition !== null &&
      contextDefinition !== null &&
      attributionDefinition !== contextDefinition) ||
    (canonicalDefinition !== null &&
      contextDefinition !== null &&
      canonicalDefinition !== contextDefinition);
  if (nameConflict || definitionConflict) {
    return { candidate: null, conflicting: true };
  }

  return {
    candidate: {
      key: JSON.stringify([countryTag, identity.id, identity.type]),
      identity,
      name: canonicalName ?? attributionName ?? contextName,
      definition:
        canonicalDefinition ?? attributionDefinition ?? contextDefinition,
    },
    conflicting: false,
  };
}

function resolveWithContextMap(
  event: NavalLossEvent,
  contexts: ReadonlyMap<string, NavalLossParentContext>,
): NavalKillResolution {
  const primary = event.attributions.filter(
    ({ role }) => role === 'primary_observed',
  );
  if (primary.length === 0) {
    return {
      eventId: event.eventId,
      countryResolution: 'no_primary_attribution',
      shipResolution: 'not_applicable',
      creditedKill: null,
    };
  }

  const countries = uniqueKnown(
    primary.map(({ killerCountryTag }) => killerCountryTag),
  );
  if (countries.conflicting) {
    return {
      eventId: event.eventId,
      countryResolution: 'conflicting_killer_countries',
      shipResolution: 'not_applicable',
      creditedKill: null,
    };
  }
  if (countries.value === null) {
    return {
      eventId: event.eventId,
      countryResolution: 'missing_killer_country',
      shipResolution: 'not_applicable',
      creditedKill: null,
    };
  }

  const countryTag = countries.value;
  const matchingPrimary = primary.filter((attribution) =>
    matchingCountry(attribution, countryTag),
  );
  const names = uniqueKnown(
    matchingPrimary.map(({ killerName }) => killerName),
  );
  const definitions = uniqueKnown(
    matchingPrimary.map(({ killerDefinition }) => killerDefinition),
  );
  let shipConflict = names.conflicting || definitions.conflicting;

  const provenanceAttributions = [
    ...matchingPrimary,
    ...event.attributions.filter(
      (attribution) =>
        attribution.role === 'unresolved' &&
        names.value !== null &&
        matchingCountry(attribution, countryTag) &&
        normalized(attribution.killerName) === names.value,
    ),
  ];
  const safeCandidates = new Map<string, SafeShipCandidate>();
  for (const attribution of provenanceAttributions) {
    const resolved = safeShipCandidate(
      attribution,
      countryTag,
      names.value,
      definitions.value,
      contexts,
    );
    shipConflict ||= resolved.conflicting;
    if (resolved.candidate) {
      safeCandidates.set(resolved.candidate.key, resolved.candidate);
    }
  }
  if (safeCandidates.size > 1) shipConflict = true;

  let killerShip: CreditedKillerShip | null = null;
  let shipResolution: NavalKillShipResolution = 'missing_safe_identity';
  if (shipConflict) {
    shipResolution = 'conflicting_killer_ships';
  } else if (safeCandidates.size === 1) {
    const candidate = [...safeCandidates.values()][0];
    killerShip = {
      name: candidate.name,
      definition: candidate.definition,
      identity: { ...candidate.identity },
    };
    shipResolution = 'resolved';
  } else if (names.value !== null || definitions.value !== null) {
    killerShip = {
      name: names.value,
      definition: definitions.value,
      identity: null,
    };
  }

  return {
    eventId: event.eventId,
    countryResolution: 'credited',
    shipResolution,
    creditedKill: {
      eventId: event.eventId,
      sunkShip: {
        countryTag: event.sunkShip.countryTag,
        name: event.sunkShip.name,
        definition: event.sunkShip.definition,
      },
      event: { date: event.event.date },
      killerCountryTag: countryTag,
      killerShip,
      shipCreditResolved: shipResolution === 'resolved',
    },
  };
}

export function resolveCreditedNavalKill(
  event: NavalLossEvent,
  parentContexts: readonly NavalLossParentContext[] = [],
): NavalKillResolution {
  return resolveWithContextMap(
    event,
    new Map(parentContexts.map((context) => [context.contextId, context])),
  );
}

export function resolveCreditedNavalKills(
  events: readonly NavalLossEvent[],
  parentContexts: readonly NavalLossParentContext[] = [],
): NavalKillResolution[] {
  const contexts = new Map(
    parentContexts.map((context) => [context.contextId, context]),
  );
  return events.map((event) => resolveWithContextMap(event, contexts));
}
