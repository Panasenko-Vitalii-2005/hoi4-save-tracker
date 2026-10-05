import type { MetricId, MetricSeries, SourceRef } from './intelligence.types';

interface MetricSemantics {
  id: MetricId;
  temporalKind: MetricSeries['temporalKind'];
  unit: MetricSeries['unit'];
  identityDimensions: readonly (
    'countryTag' | 'resource' | 'equipmentDefinition'
  )[];
  optionalIdentityDimensions?: readonly 'equipmentDefinition'[];
  absoluteDelta: true;
  relativeDelta: boolean;
  signedCrossing: boolean;
  basis: SourceRef['basis'];
  limitations: readonly string[];
}

const allocation = {
  temporalKind: 'allocation',
  unit: 'factories',
  absoluteDelta: true,
  relativeDelta: true,
  signedCrossing: false,
  basis: 'persisted_aggregate',
  limitations: [
    'aggregate_source_coverage_unknown',
    'allocation_is_not_realized_output',
  ],
} as const;

export const METRIC_REGISTRY = {
  'industry.effectiveMilitaryFactories': {
    id: 'industry.effectiveMilitaryFactories',
    temporalKind: 'state',
    unit: 'factories',
    identityDimensions: ['countryTag'],
    absoluteDelta: true,
    relativeDelta: true,
    signedCrossing: false,
    basis: 'persisted_aggregate',
    limitations: ['industry_aggregate_source_coverage_unknown'],
  },
  'production.activeFactories': {
    id: 'production.activeFactories',
    ...allocation,
    identityDimensions: ['countryTag'],
    optionalIdentityDimensions: ['equipmentDefinition'],
  },
  'stockpile.balance': {
    id: 'stockpile.balance',
    temporalKind: 'balance',
    unit: 'equipment_units',
    identityDimensions: ['countryTag', 'equipmentDefinition'],
    absoluteDelta: true,
    relativeDelta: false,
    signedCrossing: true,
    basis: 'persisted_aggregate',
    limitations: [
      'aggregate_source_coverage_unknown',
      'stockpile_is_recorded_balance_not_requirement',
    ],
  },
  'economy.productionDemand': {
    id: 'economy.productionDemand',
    temporalKind: 'demand',
    unit: 'resource_units',
    identityDimensions: ['countryTag', 'resource'],
    absoluteDelta: true,
    relativeDelta: true,
    signedCrossing: false,
    basis: 'persisted_aggregate',
    limitations: ['nominal_saved_demand_not_supplied_quantity'],
  },
  'economy.serializedBalance': {
    id: 'economy.serializedBalance',
    temporalKind: 'balance',
    unit: 'resource_units',
    identityDimensions: ['countryTag', 'resource'],
    absoluteDelta: true,
    relativeDelta: false,
    signedCrossing: true,
    basis: 'serialized_ledger',
    limitations: ['serialized_state_not_next_runtime_tick'],
  },
} as const satisfies Record<MetricId, MetricSemantics>;
