import {
  buildCountryProductionIndex,
  type CountryProductionIndex,
} from '../country-production.index';
import {
  findDirectBlocks,
  readDirectScalars,
  type DirectScalarMap,
  type LocatedBlock,
} from '../naval-loss/global-history.parser';
import { findDirectAnonymousBlocks } from '../production/military-production.parser';
import { readEquipmentRef } from '../stockpile/equipment-registry.parser';
import {
  ECONOMY_RESOURCES,
  type CommercialResourceTrade,
  type EconomyAnalysis,
  type EconomyConvoySubscriber,
  type EconomyDeliveryRoute,
  type EconomyProductionDemand,
  type EconomyResource,
  type EconomyResourceMap,
  type ResourceRightsOrigin,
} from './economy.types';

const COUNTRY_TAG = /^[A-Z][A-Z0-9]{2}$/;

function isResource(value: string | undefined): value is EconomyResource {
  return ECONOMY_RESOURCES.some((resource) => resource === value);
}

function number(
  scalars: DirectScalarMap,
  key: string,
  warnings: string[],
): number | null {
  const raw = scalars.get(key);
  if (raw === undefined) return null;
  const value = raw.trim() === '' ? NaN : Number(raw);
  if (Number.isFinite(value)) return value;
  warnings.push(`invalid ${key}: ${raw}`);
  return null;
}

function tag(value: string | undefined): string | null {
  return value && COUNTRY_TAG.test(value) ? value : null;
}

/** Add finite serialized decimals without UI rounding or subtraction noise. */
function sumLedgerDecimals(rawValues: (string | undefined)[]): number {
  const values = rawValues.map((value) => value ?? '0');
  if (
    values.some(
      (value) => value.length > 128 || !/^-?\d+(?:\.\d+)?$/.test(value),
    )
  ) {
    return values.reduce((sum, value) => sum + Number(value), 0);
  }
  const parts = values.map((value) => value.split('.'));
  const scale = Math.max(...parts.map((parts) => parts[1]?.length ?? 0));
  const sum = parts.reduce((total, [whole, fraction = '']) => {
    const sign = whole.startsWith('-') ? -1n : 1n;
    const digits = whole.replace('-', '') + fraction.padEnd(scale, '0');
    return total + sign * BigInt(digits);
  }, 0n);
  const sign = sum < 0n ? '-' : '';
  const digits = (sum < 0n ? -sum : sum).toString().padStart(scale + 1, '0');
  return Number(
    scale
      ? `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`
      : `${sign}${digits}`,
  );
}

function emptyMap(): EconomyResourceMap {
  return {
    aluminium: null,
    rubber: null,
    tungsten: null,
    steel: null,
    chromium: null,
    coal: null,
  };
}

function single(
  blocks: readonly LocatedBlock[],
  key: string,
  warnings: string[],
): LocatedBlock | undefined {
  const matches = blocks.filter((block) => block.key === key);
  if (matches.length > 1) warnings.push(`ambiguous ${key} blocks`);
  const block = matches.length === 1 ? matches[0] : undefined;
  if (block && !block.complete) {
    warnings.push(`unterminated ${key}`);
    return undefined;
  }
  return block;
}

function children(text: string, block: LocatedBlock): LocatedBlock[] {
  return findDirectBlocks(text, block.bodyStart, block.bodyEnd);
}

function resourceMap(
  text: string,
  block: LocatedBlock | undefined,
  warnings: string[],
): EconomyResourceMap {
  const result = emptyMap();
  if (!block) return result;
  const scalars = readDirectScalars(text, block.bodyStart, block.bodyEnd);
  for (const resource of ECONOMY_RESOURCES)
    result[resource] = number(scalars, resource, warnings);
  return result;
}

function path(
  text: string,
  block: LocatedBlock | undefined,
  warnings: string[],
): number[] | null {
  if (!block) return null;
  const tokens = text.slice(block.bodyStart, block.bodyEnd).trim();
  if (!tokens) return [];
  const values = tokens.split(/\s+/).map(Number);
  if (values.every((value) => Number.isSafeInteger(value) && value >= 0))
    return values;
  warnings.push(`invalid ${block.key}`);
  return null;
}

function route(
  text: string,
  block: LocatedBlock | undefined,
  warnings: string[],
): EconomyDeliveryRoute | null {
  if (!block) return null;
  const scalars = readDirectScalars(text, block.bodyStart, block.bodyEnd);
  const blocks = children(text, block);
  const typeRaw = number(scalars, 'type', warnings);
  return {
    typeRaw,
    routeType: typeRaw === 1 ? 'land' : typeRaw === 2 ? 'sea' : null,
    senderTag: tag(scalars.get('sender')),
    receiverTag: tag(scalars.get('receiver')),
    fromState: number(scalars, 'from_state', warnings),
    toState: number(scalars, 'to_state', warnings),
    convoysOwnerTag: tag(scalars.get('convoys_owner')),
    landPath: path(text, single(blocks, 'land_path', warnings), warnings),
    navalPath: path(text, single(blocks, 'naval_path', warnings), warnings),
  };
}

function subscriber(
  text: string,
  block: LocatedBlock | undefined,
  warnings: string[],
): EconomyConvoySubscriber | null {
  if (!block) return null;
  const scalars = readDirectScalars(text, block.bodyStart, block.bodyEnd);
  return {
    convoys: number(scalars, 'convoys', warnings),
    total: number(scalars, 'total', warnings),
  };
}

function trades(
  text: string,
  exporterTag: string,
  blocks: readonly LocatedBlock[],
  countryWarnings: string[],
): CommercialResourceTrade[] {
  const routesBlock = single(blocks, 'delivery_routes', countryWarnings);
  const routes = routesBlock ? children(text, routesBlock) : [];
  const records: CommercialResourceTrade[] = [];
  for (const block of blocks.filter((entry) => entry.key === 'export')) {
    const scalars = readDirectScalars(text, block.bodyStart, block.bodyEnd);
    const resource = scalars.get('resource');
    if (!isResource(resource)) continue;
    const warnings: string[] = [];
    if (!block.complete) warnings.push('unterminated export');
    const importerTag = tag(scalars.get('receiver'));
    if (!importerTag) warnings.push('missing or invalid receiver');
    const nested = children(text, block);
    const routeBlock =
      single(nested, 'delivery_route', warnings) ??
      (importerTag ? single(routes, importerTag, warnings) : undefined);
    records.push({
      relationRef: readEquipmentRef(text, block, 'id', warnings, true),
      exporterTag,
      importerTag,
      resource,
      deliveredRaw: number(scalars, 'delivered', warnings),
      efficiency: number(scalars, 'efficiency', warnings),
      efficiencyDueToLostConvoys: number(
        scalars,
        'efficiency_due_to_lost_convoys',
        warnings,
      ),
      requiredCic: number(scalars, 'required_cic', warnings),
      lendedCic: number(scalars, 'lended_cic', warnings),
      requestRaw: number(scalars, 'request', warnings),
      route: route(text, routeBlock, warnings),
      convoySubscriber: subscriber(
        text,
        single(nested, 'convoys_subscriber', warnings),
        warnings,
      ),
      warnings,
    });
  }
  return records;
}

function rights(
  text: string,
  beneficiaryTag: string,
  blocks: readonly LocatedBlock[],
): ResourceRightsOrigin[] {
  const records: ResourceRightsOrigin[] = [];
  for (const extra of blocks.filter(
    (block) => block.key === 'extra_resource_origin',
  )) {
    const warnings: string[] = [];
    if (!extra.complete) warnings.push('unterminated extra_resource_origin');
    const extraScalars = readDirectScalars(
      text,
      extra.bodyStart,
      extra.bodyEnd,
    );
    const origin = single(children(text, extra), 'origin', warnings);
    if (!origin) continue;
    const scalars = readDirectScalars(text, origin.bodyStart, origin.bodyEnd);
    const nested = children(text, origin);
    const given = single(nested, 'given_resource_rights', warnings);
    const givenResourceRights: ResourceRightsOrigin['givenResourceRights'] = [];
    if (given) {
      for (const entry of findDirectAnonymousBlocks(
        text,
        given.bodyStart,
        given.bodyEnd,
      )) {
        const tuple = /^\s*([a-z_]+)\s+"([A-Z][A-Z0-9]{2})"\s*$/.exec(
          text.slice(entry.bodyStart, entry.bodyEnd),
        );
        if (!entry.complete || !tuple)
          warnings.push('invalid given_resource_rights tuple');
        else if (isResource(tuple[1]))
          givenResourceRights.push({
            resource: tuple[1],
            beneficiaryTag: tuple[2],
          });
      }
    }
    records.push({
      beneficiaryTag,
      giverTag: tag(extraScalars.get('giver')),
      stateId: number(scalars, 'state', warnings),
      originRef: readEquipmentRef(text, origin, 'id', warnings, true),
      resources: resourceMap(
        text,
        single(nested, 'resources', warnings),
        warnings,
      ),
      // The misspelling is the actual serialized HoI4 field name.
      resourcesUnclamped: resourceMap(
        text,
        single(nested, 'resources_unclapmed', warnings),
        warnings,
      ),
      givenResourceRights,
      efficiency: number(scalars, 'efficiency', warnings),
      efficiencyDueToLostConvoys: number(
        scalars,
        'efficiency_due_to_lost_convoys',
        warnings,
      ),
      requestRaw: number(scalars, 'request', warnings),
      route: route(text, single(nested, 'delivery_route', warnings), warnings),
      convoySubscriber: subscriber(
        text,
        single(nested, 'convoys_subscriber', warnings),
        warnings,
      ),
      warnings,
    });
  }
  return records;
}

type DemandSource = Exclude<keyof EconomyProductionDemand, 'total'>;

function productionDemands(
  text: string,
  productionBlocks: readonly LocatedBlock[],
  warnings: string[],
): Record<EconomyResource, EconomyProductionDemand> {
  const demands = Object.fromEntries(
    ECONOMY_RESOURCES.map((resource) => [
      resource,
      { military: null, naval: null, refit: null, energy: null, total: null },
    ]),
  ) as Record<EconomyResource, EconomyProductionDemand>;
  const invalid = new Set<EconomyResource>();
  let incomplete = false;
  const sources = new Map<string, DemandSource>([
    ['military_lines', 'military'],
    ['naval_lines', 'naval'],
    ['ship_refit_lines', 'refit'],
    ['energy_production_cost', 'energy'],
  ]);
  for (const production of productionBlocks) {
    if (!production.complete) incomplete = true;
    for (const line of children(text, production)) {
      const source = sources.get(line.key);
      if (!source) continue;
      if (!line.complete) incomplete = true;
      const resources = single(children(text, line), 'resources', warnings);
      // energy_production_cost is itself a resource/amount/need entry.
      if (source !== 'energy' && !resources) {
        warnings.push(`missing ${line.key}.resources`);
        incomplete = true;
        continue;
      }
      const entries = resources
        ? findDirectAnonymousBlocks(
            text,
            resources.bodyStart,
            resources.bodyEnd,
          )
        : [line];
      for (const entry of entries) {
        if (!entry.complete) incomplete = true;
        const scalars = readDirectScalars(text, entry.bodyStart, entry.bodyEnd);
        const resource = scalars.get('resource');
        if (!isResource(resource)) continue;
        const amount = number(scalars, 'amount', warnings);
        if (amount === null) {
          invalid.add(resource);
          warnings.push(`missing or invalid ${line.key}.${resource}.amount`);
        } else
          demands[resource][source] = (demands[resource][source] ?? 0) + amount;
      }
    }
  }
  for (const resource of ECONOMY_RESOURCES) {
    const demand = demands[resource];
    if (incomplete || invalid.has(resource)) continue;
    const present = [
      demand.military,
      demand.naval,
      demand.refit,
      demand.energy,
    ].filter((value): value is number => value !== null);
    demand.total = present.length
      ? present.reduce((sum, value) => sum + value, 0)
      : null;
  }
  return demands;
}

function ledger(
  text: string,
  block: LocatedBlock | undefined,
  warnings: string[],
): {
  available: EconomyResourceMap;
  projects: EconomyResourceMap;
  production: EconomyResourceMap;
  balance: EconomyResourceMap;
} {
  const result = {
    available: emptyMap(),
    projects: emptyMap(),
    production: emptyMap(),
    balance: emptyMap(),
  };
  if (!block) return result;
  const entries = findDirectAnonymousBlocks(
    text,
    block.bodyStart,
    block.bodyEnd,
  );
  // Only the validated layout is mapped into public semantic names. Unknown
  // layouts remain nullable rather than exposing arbitrary array positions.
  if (
    entries.length !== 3 ||
    entries.some((entry) => !entry.complete) ||
    children(text, block).length > 0 ||
    readDirectScalars(text, block.bodyStart, block.bodyEnd).size > 0
  ) {
    warnings.push('unsupported to_use ledger layout');
    return result;
  }
  const maps = entries.map((entry) =>
    readDirectScalars(text, entry.bodyStart, entry.bodyEnd),
  );
  for (const resource of ECONOMY_RESOURCES) {
    const values = maps.map((map) => number(map, resource, warnings));
    const [available, project, production] = values;
    if (
      maps.some((map, index) => map.has(resource) && values[index] === null) ||
      (project !== null && project > 0) ||
      (production !== null && production > 0)
    ) {
      warnings.push(`unsupported ${resource} to_use contribution`);
      continue;
    }
    result.available[resource] = available;
    result.projects[resource] =
      project === null ? null : project === 0 ? 0 : -project;
    result.production[resource] =
      production === null ? null : production === 0 ? 0 : -production;
    // An omitted resource in a present sparse demand map contributes nothing;
    // this does NOT turn an absent national imported/project field into zero.
    if (available !== null) {
      const balance = sumLedgerDecimals(maps.map((map) => map.get(resource)));
      if (Number.isFinite(balance)) result.balance[resource] = balance;
      else warnings.push(`non-finite ${resource} to_use balance`);
    }
  }
  return result;
}

export function parseEconomy(
  text: string,
  countryIndex: CountryProductionIndex = buildCountryProductionIndex(text),
): EconomyAnalysis {
  const result: EconomyAnalysis = {
    stateBasis: 'serialized',
    countrySummaries: [],
    commercialTrades: [],
    resourceRightsOrigins: [],
  };
  for (const { countryTag, countryBlock, productionBlocks } of countryIndex) {
    const warnings: string[] = [];
    const countryBlocks = children(text, countryBlock);
    const resources = single(countryBlocks, 'resources', warnings);
    if (!resources) continue;
    const resourceBlocks = children(text, resources);
    const maps = new Map<string, EconomyResourceMap>();
    for (const key of [
      'produced',
      'imported',
      'base_export',
      'to_export',
      'exported',
      'transfer_overlord_subject',
    ]) {
      maps.set(
        key,
        resourceMap(text, single(resourceBlocks, key, warnings), warnings),
      );
    }
    const program = single(countryBlocks, 'program_status', warnings);
    const pool = program
      ? single(children(text, program), 'project_pool', warnings)
      : undefined;
    const projects = resourceMap(
      text,
      pool ? single(children(text, pool), 'resources', warnings) : undefined,
      warnings,
    );
    const demands = productionDemands(text, productionBlocks, warnings);
    const savedLedger = ledger(
      text,
      single(resourceBlocks, 'to_use', warnings),
      warnings,
    );
    result.commercialTrades.push(
      ...trades(text, countryTag, resourceBlocks, warnings),
    );
    result.resourceRightsOrigins.push(
      ...rights(text, countryTag, resourceBlocks),
    );
    result.countrySummaries.push({
      countryTag,
      resources: ECONOMY_RESOURCES.map((resource) => ({
        resource,
        extracted: maps.get('produced')![resource],
        imported: maps.get('imported')![resource],
        baseExport: maps.get('base_export')![resource],
        exportAllocation: maps.get('to_export')![resource],
        savedExported: maps.get('exported')![resource],
        transferOverlordSubject: maps.get('transfer_overlord_subject')![
          resource
        ],
        projectDemand: projects[resource],
        productionDemand: demands[resource],
        serializedAvailableBeforeDemand: savedLedger.available[resource],
        serializedProjectDemand: savedLedger.projects[resource],
        serializedProductionDemand: savedLedger.production[resource],
        serializedBalance: savedLedger.balance[resource],
      })),
      warnings,
    });
  }
  return result;
}
