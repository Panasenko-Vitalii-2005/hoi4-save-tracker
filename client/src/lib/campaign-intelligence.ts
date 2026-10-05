import type { CampaignTrend } from "@/types/campaign-trends";
import type {
  CampaignIntelligenceDto,
  MetricKey,
} from "@/types/campaign-intelligence";
import { INSIGHT_FAMILIES } from "@/types/campaign-intelligence";
import { ECONOMY_RESOURCES } from "@/types/economy";

/** Game date only. analyzedAt is never an in-game chronology tie-breaker. */
export function intelligenceDay(value: string): number | null {
  const match = /^(\d{1,4})\.(\d{1,2})\.(\d{1,2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1]
    ? year * 10000 + month * 100 + day
    : null;
}

export function defaultIntelligenceWindow(campaign: CampaignTrend): {
  baseHash: string;
  targetHash: string;
} {
  const valid = campaign.snapshots
    .filter((s) => intelligenceDay(s.gameDate) !== null)
    .toSorted(
      (a, b) =>
        intelligenceDay(a.gameDate)! - intelligenceDay(b.gameDate)! ||
        (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0),
    );
  const base = valid[0];
  const target = valid.at(-1);
  // Known conflicts anywhere in the default interval make it unsuitable for interpretation.
  const versions = new Set(
    valid.map((s) => s.gameVersion).filter((v) => v !== null),
  );
  return base &&
    target &&
    intelligenceDay(base.gameDate)! < intelligenceDay(target.gameDate)! &&
    versions.size <= 1
    ? { baseHash: base.hash, targetHash: target.hash }
    : { baseHash: "", targetHash: "" };
}

export const INSIGHT_MESSAGES = {
  INDUSTRY_ALLOCATION_EXPANSION: "intelligence.industryAllocationExpansion",
  INDUSTRIAL_EXPANSION_WITH_RESOURCE_CROSSING:
    "intelligence.industrialExpansionWithResourceCrossing",
  RESOURCE_PRESSURE_WITH_HIGHER_DEMAND:
    "intelligence.resourcePressureWithHigherDemand",
  RESOURCE_RECOVERY_WITH_MAINTAINED_DEMAND:
    "intelligence.resourceRecoveryWithMaintainedDemand",
  ALLOCATION_WITH_STOCKPILE_DECLINE:
    "intelligence.allocationWithStockpileDecline",
  EQUIPMENT_DEFICIT_DURING_ALLOCATION_EXPANSION:
    "intelligence.equipmentDeficitDuringAllocationExpansion",
} as const;

export function supportedInsight(
  insight: CampaignIntelligenceDto["insights"][number],
): boolean {
  const resourceFamily = [
    "INDUSTRIAL_EXPANSION_WITH_RESOURCE_CROSSING",
    "RESOURCE_PRESSURE_WITH_HIGHER_DEMAND",
    "RESOURCE_RECOVERY_WITH_MAINTAINED_DEMAND",
  ].includes(insight.catalogId);
  const equipmentFamily = [
    "ALLOCATION_WITH_STOCKPILE_DECLINE",
    "EQUIPMENT_DEFICIT_DURING_ALLOCATION_EXPANSION",
  ].includes(insight.catalogId);
  return (
    INSIGHT_FAMILIES.includes(insight.catalogId) &&
    insight.catalogVersion === 1 &&
    insight.messageKey === INSIGHT_MESSAGES[insight.catalogId] &&
    insight.causalClaim === false &&
    (!resourceFamily ||
      ECONOMY_RESOURCES.includes(
        insight.messageParams.resource as (typeof ECONOMY_RESOURCES)[number],
      )) &&
    (!equipmentFamily ||
      (typeof insight.messageParams.equipmentDefinition === "string" &&
        insight.messageParams.equipmentDefinition.length > 0)) &&
    (insight.messageParams.resource === undefined ||
      ECONOMY_RESOURCES.includes(
        insight.messageParams.resource as (typeof ECONOMY_RESOURCES)[number],
      )) &&
    (insight.messageParams.equipmentDefinition === undefined ||
      (typeof insight.messageParams.equipmentDefinition === "string" &&
        insight.messageParams.equipmentDefinition.length > 0))
  );
}

export const METRIC_LABELS: Record<MetricKey["id"], string> = {
  "industry.effectiveMilitaryFactories": "campaign.metrics.militaryFactories",
  "production.activeFactories": "campaign.metrics.activeFactories",
  "stockpile.balance": "campaign.metrics.stockpileBalance",
  "economy.productionDemand": "intelligence.productionDemand",
  "economy.serializedBalance": "economy.balance",
};

// Narrow the HTTP boundary before rendering nested evidence. Unknown catalog/message IDs
// remain strings on the wire and are handled by the explicit renderer allowlist above.
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const numberOrNull = (v: unknown) =>
  v === null || (typeof v === "number" && Number.isFinite(v));
const metric = (v: unknown) =>
  object(v) &&
  typeof v.id === "string" &&
  Object.hasOwn(METRIC_LABELS, v.id) &&
  typeof v.countryTag === "string" &&
  (v.resource === undefined ||
    ECONOMY_RESOURCES.includes(
      v.resource as (typeof ECONOMY_RESOURCES)[number],
    )) &&
  (v.equipmentDefinition === undefined ||
    typeof v.equipmentDefinition === "string");
const sources = (v: unknown) =>
  Array.isArray(v) &&
  v.every(
    (x) =>
      object(x) &&
      typeof x.snapshotHash === "string" &&
      typeof x.resultPath === "string" &&
      ["persisted_aggregate", "serialized_ledger"].includes(String(x.basis)),
  );
const confidence = (v: unknown) =>
  object(v) &&
  ["high", "medium"].includes(String(v.level)) &&
  v.semanticBasis === "proven_recorded_state" &&
  strings(v.reasons);
const summary = (v: unknown) =>
  object(v) &&
  metric(v.metric) &&
  [v.startValue, v.endValue, v.delta, v.relativeDelta].every(numberOrNull) &&
  typeof v.observedCount === "number" &&
  typeof v.missingCount === "number";

export function isCampaignIntelligenceDto(
  v: unknown,
): v is CampaignIntelligenceDto {
  if (!object(v) || !object(v.window)) return false;
  const w = v.window;
  return (
    typeof v.algorithmVersion === "string" &&
    v.stateBasis === "serialized" &&
    [
      w.campaignKey,
      w.countryTag,
      w.baseHash,
      w.targetHash,
      w.baseGameDate,
      w.targetGameDate,
    ].every((x) => typeof x === "string") &&
    typeof w.temporalEligible === "boolean" &&
    strings(w.snapshotHashes) &&
    strings(w.suppressionReasons) &&
    Array.isArray(v.series) &&
    v.series.every(
      (x) =>
        object(x) &&
        metric(x.key) &&
        ["state", "allocation", "demand", "balance"].includes(
          String(x.temporalKind),
        ) &&
        ["factories", "equipment_units", "resource_units"].includes(
          String(x.unit),
        ) &&
        Array.isArray(x.observations) &&
        x.observations.every(
          (o) =>
            object(o) &&
            typeof o.snapshotHash === "string" &&
            numberOrNull(o.value) &&
            strings(o.qualifiers) &&
            sources(o.sources) &&
            ((o.status === "observed" && typeof o.value === "number") ||
              (o.status === "missing" &&
                o.value === null &&
                ["legacy", "absent", "invalid", "unavailable"].includes(
                  String(o.reason),
                ))),
        ),
    ) &&
    Array.isArray(v.summaries) &&
    v.summaries.every(summary) &&
    Array.isArray(v.signals) &&
    v.signals.every(
      (x) =>
        object(x) &&
        typeof x.id === "string" &&
        [
          "increase",
          "decrease",
          "maintained",
          "positive_to_negative",
          "negative_to_nonnegative",
        ].includes(String(x.type)) &&
        typeof x.ruleVersion === "number" &&
        metric(x.metric) &&
        summary(x.summary) &&
        strings(x.evidenceIds) &&
        confidence(x.confidence) &&
        (x.crossingBracket === undefined ||
          (object(x.crossingBracket) &&
            typeof x.crossingBracket.beforeHash === "string" &&
            typeof x.crossingBracket.afterHash === "string")),
    ) &&
    Array.isArray(v.evidence) &&
    v.evidence.every(
      (x) =>
        object(x) &&
        typeof x.id === "string" &&
        typeof x.operation === "string" &&
        typeof x.layer === "string" &&
        (x.metric === undefined || metric(x.metric)) &&
        sources(x.sources) &&
        Array.isArray(x.rawValues) &&
        x.rawValues.every(numberOrNull) &&
        strings(x.inputEvidenceIds) &&
        strings(x.qualifiers),
    ) &&
    Array.isArray(v.insights) &&
    v.insights.every(
      (x) =>
        object(x) &&
        typeof x.id === "string" &&
        typeof x.catalogId === "string" &&
        typeof x.catalogVersion === "number" &&
        typeof x.messageKey === "string" &&
        object(x.messageParams) &&
        Object.values(x.messageParams).every(
          (p) => typeof p === "string" || typeof p === "number",
        ) &&
        strings(x.signalIds) &&
        strings(x.evidenceIds) &&
        confidence(x.confidence) &&
        ["informational", "attention"].includes(String(x.severity)) &&
        strings(x.qualifiers) &&
        typeof x.causalClaim === "boolean",
    ) &&
    Array.isArray(v.coverageIssues) &&
    v.coverageIssues.every(
      (x) =>
        object(x) &&
        typeof x.code === "string" &&
        (x.metric === undefined || metric(x.metric)) &&
        (x.snapshotHash === undefined || typeof x.snapshotHash === "string"),
    )
  );
}
