/** Mirror of the accepted Phase 1A public contract; checked by contract tests. */
import type { EconomyResource } from "./economy";

export const ALGORITHM_VERSION = "1.0.0";
export const CATALOG_VERSION = 1;
export type TemporalKind = "state" | "allocation" | "demand" | "balance";
export type MetricId =
  | "industry.effectiveMilitaryFactories"
  | "production.activeFactories"
  | "stockpile.balance"
  | "economy.productionDemand"
  | "economy.serializedBalance";
export interface MetricKey {
  id: MetricId;
  countryTag: string;
  resource?: EconomyResource;
  equipmentDefinition?: string;
}
export interface SourceRef {
  snapshotHash: string;
  resultPath: string;
  basis: "persisted_aggregate" | "serialized_ledger";
}
export type MissingReason = "legacy" | "absent" | "invalid" | "unavailable";
export type MetricObservation = {
  snapshotHash: string;
  sources: SourceRef[];
  qualifiers: string[];
} & (
  | { status: "observed"; value: number }
  | { status: "missing"; value: null; reason: MissingReason }
);
export interface MetricSeries {
  key: MetricKey;
  temporalKind: TemporalKind;
  unit: "factories" | "equipment_units" | "resource_units";
  observations: MetricObservation[];
}
export interface IntelligenceQuery {
  campaignKey: string;
  countryTag: string;
  baseHash: string;
  targetHash: string;
}
export interface TimeWindow extends IntelligenceQuery {
  snapshotHashes: string[];
  baseGameDate: string;
  targetGameDate: string;
  selectionBasis: "explicit_endpoints_and_strictly_intermediate_game_dates";
  temporalEligible: boolean;
  suppressionReasons: string[];
}
export interface CoverageIssue {
  code: string;
  snapshotHash?: string;
  metric?: MetricKey;
}
export interface WindowSummary {
  metric: MetricKey;
  startValue: number | null;
  endValue: number | null;
  delta: number | null;
  /** Fractional relative change, not percent points; null for signed balances. */
  relativeDelta: number | null;
  observedCount: number;
  missingCount: number;
}
export interface Evidence {
  id: string;
  layer:
    | "persisted_fact"
    | "derived_arithmetic"
    | "temporal_signal"
    | "co_occurrence";
  metric?: MetricKey;
  sources: SourceRef[];
  rawValues: (number | null)[];
  operation: string;
  inputEvidenceIds: string[];
  qualifiers: string[];
  missingReason?: MissingReason;
}
export interface Confidence {
  level: "high" | "medium";
  semanticBasis: "proven_recorded_state";
  reasons: string[];
}
export type Severity = "informational" | "attention";
export type SignalType =
  | "increase"
  | "decrease"
  | "positive_to_negative"
  | "negative_to_nonnegative"
  | "maintained";
export interface Signal {
  id: string;
  ruleVersion: number;
  type: SignalType;
  metric: MetricKey;
  summary: WindowSummary;
  evidenceIds: string[];
  crossingBracket?: { beforeHash: string; afterHash: string };
  confidence: Confidence;
}
export const INSIGHT_FAMILIES = [
  "INDUSTRY_ALLOCATION_EXPANSION",
  "INDUSTRIAL_EXPANSION_WITH_RESOURCE_CROSSING",
  "RESOURCE_PRESSURE_WITH_HIGHER_DEMAND",
  "RESOURCE_RECOVERY_WITH_MAINTAINED_DEMAND",
  "ALLOCATION_WITH_STOCKPILE_DECLINE",
  "EQUIPMENT_DEFICIT_DURING_ALLOCATION_EXPANSION",
] as const;
export type InsightFamily = (typeof INSIGHT_FAMILIES)[number];
export interface Insight {
  id: string;
  catalogId: InsightFamily;
  catalogVersion: number;
  signalIds: string[];
  evidenceIds: string[];
  messageKey: string;
  messageParams: Record<string, string | number>;
  confidence: Confidence;
  severity: Severity;
  qualifiers: string[];
  causalClaim: false;
}
export interface CampaignIntelligenceDto {
  algorithmVersion: string;
  stateBasis: "serialized";
  window: TimeWindow;
  series: MetricSeries[];
  summaries: WindowSummary[];
  signals: Signal[];
  evidence: Evidence[];
  insights: Insight[];
  coverageIssues: CoverageIssue[];
}
