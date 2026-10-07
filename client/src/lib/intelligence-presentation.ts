import type {
  CampaignIntelligenceDto,
  MetricKey,
} from "@/types/campaign-intelligence";

export type CoverageDomain =
  "industry" | "production" | "stockpile" | "economy" | "other";
export function metricIdentity(metric: MetricKey): string {
  return JSON.stringify([
    metric.id,
    metric.countryTag,
    metric.resource,
    metric.equipmentDefinition,
  ]);
}
export function coverageDomain(metric: MetricKey): CoverageDomain {
  switch (metric.id) {
    case "industry.effectiveMilitaryFactories":
      return "industry";
    case "production.activeFactories":
      return "production";
    case "stockpile.balance":
      return "stockpile";
    case "economy.productionDemand":
    case "economy.serializedBalance":
      return "economy";
    default:
      return "other";
  }
}

/** Presentation only: retain every issue and count exact identities, never labels. */
export function groupCoverage(
  issues: CampaignIntelligenceDto["coverageIssues"],
) {
  const groups = new Map<
    string,
    {
      domain: CoverageDomain;
      reason: string;
      issues: typeof issues;
      definitions: Set<string>;
      identities: Set<string>;
    }
  >();
  for (const issue of issues) {
    if (!issue.metric) continue;
    const domain = coverageDomain(issue.metric);
    const key = `${domain}:${issue.code}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        domain,
        reason: issue.code,
        issues: [],
        definitions: new Set(),
        identities: new Set(),
      };
      groups.set(key, group);
    }
    group.issues.push(issue);
    group.identities.add(metricIdentity(issue.metric));
    if (issue.metric.equipmentDefinition)
      group.definitions.add(issue.metric.equipmentDefinition);
  }
  const order: CoverageDomain[] = [
    "industry",
    "production",
    "stockpile",
    "economy",
    "other",
  ];
  return [...groups.values()].sort(
    (a, b) =>
      order.indexOf(a.domain) - order.indexOf(b.domain) ||
      a.reason.localeCompare(b.reason, "en"),
  );
}

export function generalLimits(data: CampaignIntelligenceDto): string[] {
  return [
    ...new Set([
      ...data.coverageIssues
        .filter((issue) => !issue.metric)
        .map((issue) => issue.code),
      ...data.insights.flatMap((insight) => [
        ...insight.qualifiers,
        ...insight.confidence.reasons,
      ]),
      ...data.evidence.flatMap((entry) => entry.qualifiers),
      ...data.signals.flatMap((signal) => signal.confidence.reasons),
      ...data.series.flatMap((series) =>
        series.observations.flatMap((observation) => observation.qualifiers),
      ),
    ]),
  ].filter((code) => !code.startsWith("metric_"));
}

export function signedDelta(value: number | null): string {
  return value === null ? "—" : value > 0 ? `+${value}` : String(value);
}
