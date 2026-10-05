import { createHash } from 'node:crypto';
import { numericDiff } from '../analysis-comparison.service';
import type { CampaignSnapshotProjection } from '../campaign-snapshot-projection-cache.service';
import { ECONOMY_RESOURCES } from '../../hoi4/economy/economy.types';
import { METRIC_REGISTRY } from './metric-registry';
import { extractSeries, metricIdentity, textOrder } from './observations';
import {
  ALGORITHM_VERSION,
  CATALOG_VERSION,
  type CampaignIntelligenceDto,
  type Confidence,
  type CoverageIssue,
  type Evidence,
  type Insight,
  type InsightFamily,
  type MetricKey,
  type MetricSeries,
  type Signal,
  type SignalType,
  type TimeWindow,
  type WindowSummary,
} from './intelligence.types';

/** JSON arrays have fixed field order; no names, wall-clock time or random IDs. */
function id(kind: string, ingredients: unknown[]): string {
  return `${kind}:${createHash('sha256')
    .update(
      JSON.stringify([ALGORITHM_VERSION, CATALOG_VERSION, ...ingredients]),
    )
    .digest('hex')}`;
}
const unique = (values: readonly string[]): string[] =>
  [...new Set(values)].sort(textOrder);
function confidence(qualifiers: readonly string[]): Confidence {
  const reasons = unique(qualifiers);
  return {
    level: reasons.some(
      (reason) =>
        reason.includes('coverage_unknown') ||
        reason === 'unknown_game_version',
    )
      ? 'medium'
      : 'high',
    semanticBasis: 'proven_recorded_state',
    reasons,
  };
}

export function summarize(series: MetricSeries): WindowSummary {
  const startValue = series.observations[0]?.value ?? null;
  const endValue = series.observations.at(-1)?.value ?? null;
  const { delta } = numericDiff(startValue, endValue);
  const relative =
    METRIC_REGISTRY[series.key.id].relativeDelta &&
    startValue !== null &&
    startValue > 0 &&
    endValue !== null &&
    endValue >= 0 &&
    delta !== null
      ? delta / startValue
      : null;
  return {
    metric: series.key,
    startValue,
    endValue,
    delta,
    relativeDelta:
      relative !== null && Number.isFinite(relative) ? relative : null,
    observedCount: series.observations.filter(
      (value) => value.status === 'observed',
    ).length,
    missingCount: series.observations.filter(
      (value) => value.status === 'missing',
    ).length,
  };
}

/** Endpoint predicates only. Intermediate gaps are disclosed, never bridged into sustained claims. */
function signalTypes(summary: WindowSummary): SignalType[] {
  if (
    summary.delta === null ||
    summary.startValue === null ||
    summary.endValue === null
  )
    return [];
  const types: SignalType[] = [
    summary.delta > 0
      ? 'increase'
      : summary.delta < 0
        ? 'decrease'
        : 'maintained',
  ];
  if (METRIC_REGISTRY[summary.metric.id].signedCrossing) {
    if (summary.startValue > 0 && summary.endValue < 0)
      types.push('positive_to_negative');
    if (summary.startValue < 0 && summary.endValue >= 0)
      types.push('negative_to_nonnegative');
  }
  return types;
}

const messages: Record<InsightFamily, string> = {
  INDUSTRY_ALLOCATION_EXPANSION: 'intelligence.industryAllocationExpansion',
  INDUSTRIAL_EXPANSION_WITH_RESOURCE_CROSSING:
    'intelligence.industrialExpansionWithResourceCrossing',
  RESOURCE_PRESSURE_WITH_HIGHER_DEMAND:
    'intelligence.resourcePressureWithHigherDemand',
  RESOURCE_RECOVERY_WITH_MAINTAINED_DEMAND:
    'intelligence.resourceRecoveryWithMaintainedDemand',
  ALLOCATION_WITH_STOCKPILE_DECLINE:
    'intelligence.allocationWithStockpileDecline',
  EQUIPMENT_DEFICIT_DURING_ALLOCATION_EXPANSION:
    'intelligence.equipmentDeficitDuringAllocationExpansion',
};

export function generateIntelligence(
  snapshots: readonly CampaignSnapshotProjection[],
  window: TimeWindow,
  initialIssues: readonly CoverageIssue[] = [],
): CampaignIntelligenceDto {
  const series = extractSeries(snapshots, window.countryTag);
  const summaries = series.map(summarize);
  const evidence: Evidence[] = [];
  const signals: Signal[] = [];
  const insights: Insight[] = [];
  const coverageIssues: CoverageIssue[] = [...initialIssues];
  const globalQualifiers = [
    'serialized_state_at_save_time',
    'available_authorized_history_only',
    ...(snapshots.some((snapshot) => snapshot.gameVersion === null)
      ? ['unknown_game_version']
      : []),
  ];
  for (const [index, metricSeries] of series.entries()) {
    const facts = metricSeries.observations.map((observation): Evidence => {
      const fact: Evidence = {
        id: id('evidence', [
          'read',
          metricIdentity(metricSeries.key),
          observation,
        ]),
        layer: 'persisted_fact',
        metric: metricSeries.key,
        sources: observation.sources,
        rawValues: [observation.value],
        operation: 'read_projection',
        inputEvidenceIds: [],
        qualifiers: observation.qualifiers,
        ...(observation.status === 'missing'
          ? { missingReason: observation.reason }
          : {}),
      };
      if (observation.status === 'missing')
        coverageIssues.push({
          code: `metric_${observation.reason}`,
          snapshotHash: observation.snapshotHash,
          metric: metricSeries.key,
        });
      evidence.push(fact);
      return fact;
    });
    const summary = summaries[index];
    if (summary.delta === null || !window.temporalEligible) continue;
    const endpointFacts = [facts[0], facts.at(-1)!];
    const qualifiers = unique([
      ...globalQualifiers,
      ...endpointFacts.flatMap((fact) => fact.qualifiers),
      ...(summary.missingCount
        ? ['intermediate_gaps_endpoint_comparison_only']
        : []),
    ]);
    const arithmetic: Evidence = {
      id: id('evidence', [
        'target_minus_base',
        endpointFacts.map((fact) => fact.id),
      ]),
      layer: 'derived_arithmetic',
      metric: metricSeries.key,
      sources: endpointFacts.flatMap((fact) => fact.sources),
      rawValues: [summary.startValue, summary.endValue, summary.delta],
      operation: 'target_minus_base',
      inputEvidenceIds: endpointFacts.map((fact) => fact.id),
      qualifiers,
    };
    evidence.push(arithmetic);
    for (const type of signalTypes(summary)) {
      const signalEvidence: Evidence = {
        ...arithmetic,
        id: id('evidence', [type, arithmetic.id]),
        layer: 'temporal_signal',
        operation: type,
        inputEvidenceIds: [arithmetic.id],
      };
      evidence.push(signalEvidence);
      const crossing =
        type === 'positive_to_negative' || type === 'negative_to_nonnegative';
      signals.push({
        id: id('signal', [
          type,
          metricIdentity(metricSeries.key),
          window.snapshotHashes,
          signalEvidence.id,
        ]),
        ruleVersion: 1,
        type,
        metric: metricSeries.key,
        summary,
        evidenceIds: [
          ...endpointFacts.map((fact) => fact.id),
          arithmetic.id,
          signalEvidence.id,
        ],
        ...(crossing
          ? {
              crossingBracket: {
                beforeHash: window.baseHash,
                afterHash: window.targetHash,
              },
            }
          : {}),
        confidence: confidence(qualifiers),
      });
    }
  }
  const evidenceById = new Map(evidence.map((entry) => [entry.id, entry]));
  const signalsByMetric = new Map<string, Signal[]>();
  for (const signal of signals) {
    const key = metricIdentity(signal.metric);
    const entries = signalsByMetric.get(key) ?? [];
    entries.push(signal);
    signalsByMetric.set(key, entries);
  }
  const find = (
    metric: MetricKey,
    ...types: SignalType[]
  ): Signal | undefined =>
    signalsByMetric
      .get(metricIdentity(metric))
      ?.find((signal) => types.includes(signal.type));
  const add = (
    catalogId: InsightFamily,
    parts: (Signal | undefined)[],
    params: Record<string, string | number> = {},
  ) => {
    if (parts.some((part) => part === undefined)) return;
    const matched = parts as Signal[];
    const evidenceIds = unique(matched.flatMap((signal) => signal.evidenceIds));
    const qualifiers = unique(
      matched.flatMap((signal) => signal.confidence.reasons),
    );
    const combined: Evidence = {
      id: id('evidence', [
        'co_occurrence',
        catalogId,
        matched.map((signal) => signal.id),
      ]),
      layer: 'co_occurrence',
      sources: matched.flatMap(
        (signal) => evidenceById.get(signal.evidenceIds.at(-1)!)?.sources ?? [],
      ),
      rawValues: matched.flatMap((signal) => [
        signal.summary.startValue,
        signal.summary.endValue,
      ]),
      operation: 'and_endpoint_signals',
      inputEvidenceIds: evidenceIds,
      qualifiers,
    };
    evidence.push(combined);
    insights.push({
      id: id('insight', [
        catalogId,
        window.campaignKey,
        window.countryTag,
        matched.map((signal) => signal.id),
      ]),
      catalogId,
      catalogVersion: CATALOG_VERSION,
      signalIds: matched.map((signal) => signal.id),
      evidenceIds: [...evidenceIds, combined.id],
      messageKey: messages[catalogId],
      messageParams: { countryTag: window.countryTag, ...params },
      confidence: confidence(qualifiers),
      severity:
        catalogId === 'INDUSTRY_ALLOCATION_EXPANSION' ||
        catalogId === 'RESOURCE_RECOVERY_WITH_MAINTAINED_DEMAND'
          ? 'informational'
          : 'attention',
      qualifiers,
      causalClaim: false,
    });
  };
  const country = window.countryTag;
  const capacity = find(
    { id: 'industry.effectiveMilitaryFactories', countryTag: country },
    'increase',
  );
  add('INDUSTRY_ALLOCATION_EXPANSION', [
    capacity,
    find({ id: 'production.activeFactories', countryTag: country }, 'increase'),
  ]);
  for (const resource of ECONOMY_RESOURCES) {
    const balance: MetricKey = {
      id: 'economy.serializedBalance',
      countryTag: country,
      resource,
    };
    const demand: MetricKey = {
      id: 'economy.productionDemand',
      countryTag: country,
      resource,
    };
    add(
      'INDUSTRIAL_EXPANSION_WITH_RESOURCE_CROSSING',
      [capacity, find(balance, 'positive_to_negative')],
      { resource },
    );
    add(
      'RESOURCE_PRESSURE_WITH_HIGHER_DEMAND',
      [find(demand, 'increase'), find(balance, 'decrease')],
      { resource },
    );
    add(
      'RESOURCE_RECOVERY_WITH_MAINTAINED_DEMAND',
      [
        find(balance, 'negative_to_nonnegative'),
        find(demand, 'increase', 'maintained'),
      ],
      { resource },
    );
  }
  for (const metricSeries of series.filter(
    (entry) => entry.key.id === 'stockpile.balance',
  )) {
    const { equipmentDefinition } = metricSeries.key;
    const allocation = find(
      {
        id: 'production.activeFactories',
        countryTag: country,
        equipmentDefinition,
      },
      'increase',
    );
    add(
      'ALLOCATION_WITH_STOCKPILE_DECLINE',
      [allocation, find(metricSeries.key, 'decrease')],
      { equipmentDefinition: equipmentDefinition! },
    );
    add(
      'EQUIPMENT_DEFICIT_DURING_ALLOCATION_EXPANSION',
      [allocation, find(metricSeries.key, 'positive_to_negative')],
      { equipmentDefinition: equipmentDefinition! },
    );
  }
  return {
    algorithmVersion: ALGORITHM_VERSION,
    stateBasis: 'serialized',
    window,
    series,
    summaries,
    signals: signals.sort((a, b) => textOrder(a.id, b.id)),
    evidence: evidence.sort((a, b) => textOrder(a.id, b.id)),
    insights: insights.sort(
      (a, b) => textOrder(a.catalogId, b.catalogId) || textOrder(a.id, b.id),
    ),
    coverageIssues: coverageIssues.sort((a, b) =>
      textOrder(JSON.stringify(a), JSON.stringify(b)),
    ),
  };
}
