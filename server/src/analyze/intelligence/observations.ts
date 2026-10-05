import type { CampaignSnapshotProjection } from '../campaign-snapshot-projection-cache.service';
import { ECONOMY_RESOURCES } from '../../hoi4/economy/economy.types';
import { METRIC_REGISTRY } from './metric-registry';
import type {
  MetricKey,
  MetricObservation,
  MetricSeries,
} from './intelligence.types';

export const textOrder = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
export const metricIdentity = (key: MetricKey): string =>
  JSON.stringify([
    key.id,
    key.countryTag,
    key.resource ?? null,
    key.equipmentDefinition ?? null,
  ]);

function observation(
  snapshot: CampaignSnapshotProjection,
  key: MetricKey,
): MetricObservation {
  const semantics = METRIC_REGISTRY[key.id];
  const tag = JSON.stringify(key.countryTag);
  const definition = JSON.stringify(key.equipmentDefinition);
  const country = snapshot.countries.find((row) => row.tag === key.countryTag);
  const equipment = snapshot.equipmentCountries
    .find((row) => row.countryTag === key.countryTag)
    ?.definitions.find(
      (row) => row.equipmentDefinition === key.equipmentDefinition,
    );
  let value: unknown;
  let path: string;
  let legacy = false;
  switch (key.id) {
    case 'industry.effectiveMilitaryFactories':
      value = country?.metrics.militaryFactories;
      path = `by_country[tag=${tag}].effectiveMilitaryFactories`;
      break;
    case 'production.activeFactories':
      legacy = !snapshot.intelligence.domains.production;
      value =
        key.equipmentDefinition === undefined
          ? snapshot.intelligence.productionCountries.find(
              (row) => row.countryTag === key.countryTag,
            )?.activeFactories
          : equipment?.activeFactories;
      path = `militaryProductionSummaries[countryTag=${tag}]${key.equipmentDefinition === undefined ? '' : `.definitions[equipmentDefinition=${definition}]`}.activeFactories`;
      break;
    case 'stockpile.balance':
      legacy = !snapshot.intelligence.domains.stockpile;
      value = equipment?.stockpileBalance;
      path = `stockpileSummaries[countryTag=${tag}].definitions[definition=${definition}].amount`;
      break;
    case 'economy.productionDemand':
    case 'economy.serializedBalance': {
      legacy = !snapshot.intelligence.domains.economy;
      const row = key.resource ? country?.economy?.[key.resource] : undefined;
      value =
        key.id === 'economy.productionDemand'
          ? row?.productionDemand
          : row?.serializedBalance;
      path = `economy.countrySummaries[countryTag=${tag}].resources[resource=${JSON.stringify(key.resource)}].${key.id === 'economy.productionDemand' ? 'productionDemand.total' : 'serializedBalance'}`;
      break;
    }
  }
  const base = {
    snapshotHash: snapshot.hash,
    sources: [
      { snapshotHash: snapshot.hash, resultPath: path, basis: semantics.basis },
    ],
    qualifiers: [...semantics.limitations],
  };
  return typeof value === 'number' && Number.isFinite(value)
    ? { ...base, status: 'observed', value }
    : {
        ...base,
        status: 'missing',
        value: null,
        reason: legacy ? 'legacy' : value == null ? 'absent' : 'invalid',
      };
}

/** Exact definition union; no names, variant refs, rates, need, or trade sums. */
export function extractSeries(
  snapshots: readonly CampaignSnapshotProjection[],
  countryTag: string,
): MetricSeries[] {
  const keys: MetricKey[] = [
    { id: 'industry.effectiveMilitaryFactories', countryTag },
    { id: 'production.activeFactories', countryTag },
    ...ECONOMY_RESOURCES.flatMap((resource): MetricKey[] => [
      { id: 'economy.productionDemand', countryTag, resource },
      { id: 'economy.serializedBalance', countryTag, resource },
    ]),
  ];
  const definitions = new Set(
    snapshots.flatMap(
      (snapshot) =>
        snapshot.equipmentCountries
          .find((row) => row.countryTag === countryTag)
          ?.definitions.map((row) => row.equipmentDefinition) ?? [],
    ),
  );
  for (const equipmentDefinition of [...definitions].sort(textOrder))
    keys.push(
      { id: 'production.activeFactories', countryTag, equipmentDefinition },
      { id: 'stockpile.balance', countryTag, equipmentDefinition },
    );
  return keys
    .sort((a, b) => textOrder(metricIdentity(a), metricIdentity(b)))
    .map((key) => ({
      key,
      temporalKind: METRIC_REGISTRY[key.id].temporalKind,
      unit: METRIC_REGISTRY[key.id].unit,
      observations: snapshots.map((snapshot) => observation(snapshot, key)),
    }));
}
