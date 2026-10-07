import type {
  CampaignIntelligenceDto,
  MetricKey,
  Signal,
  InsightFamily,
} from "../../src/types/campaign-intelligence";
import type {
  CampaignTrend,
  CampaignTrendsDto,
} from "../../src/types/campaign-trends";
import { INSIGHT_MESSAGES } from "../../src/lib/campaign-intelligence";

export const hash = (letter: string) => letter.repeat(64);
export const campaignKey = "campaign:0731c3c7-035e-46b1-b07b-6c35b27e8dc2";
export function campaignFixture(): CampaignTrend {
  const metrics = {
    divisions: 1,
    manpowerInField: 1,
    aircraft: 1,
    ships: 1,
    militaryFactories: 10,
    civilianFactories: 1,
    dockyards: 1,
    calculatedCasualties: null,
  };
  return {
    key: campaignKey,
    campaignId: campaignKey.slice(9),
    playerCountryTag: "GER",
    relationship: "known",
    snapshotCount: 3,
    firstGameDate: "1941.1.1",
    latestGameDate: "1942.1.1",
    gameVersions: ["1.19.2"],
    snapshots: ["1941.1.1", "1941.6.15", "1942.1.1"].map((gameDate, index) => ({
      hash: hash(["a", "b", "c"][index]),
      fileName: `${index}.hoi4`,
      gameDate,
      analyzedAt: "2026-01-01T00:00:00Z",
      gameVersion: "1.19.2",
      metrics: { ...metrics, activeCountries: 2 },
      countries: ["GER", "USA"].map((tag) => ({ tag, metrics })),
    })),
  };
}
export function trendsFixture(): CampaignTrendsDto {
  const campaign = campaignFixture();
  return { snapshotCount: 3, campaigns: [campaign] };
}

/** Read-only wire fixture: exactly the accepted DTO, with endpoint predicates matching each catalog rule. */
export function intelligenceFixture(): CampaignIntelligenceDto {
  const data: CampaignIntelligenceDto = {
    algorithmVersion: "1.0.0",
    stateBasis: "serialized",
    window: {
      campaignKey,
      countryTag: "GER",
      baseHash: hash("a"),
      targetHash: hash("c"),
      baseGameDate: "1941.1.1",
      targetGameDate: "1942.1.1",
      snapshotHashes: [hash("a"), hash("b"), hash("c")],
      temporalEligible: true,
      suppressionReasons: [],
      selectionBasis: "explicit_endpoints_and_strictly_intermediate_game_dates",
    },
    series: [],
    summaries: [],
    signals: [],
    evidence: [],
    insights: [],
    coverageIssues: [{ code: "available_authorized_history_only" }],
  };
  const confidence = {
    level: "high",
    semanticBasis: "proven_recorded_state",
    reasons: ["serialized_state_at_save_time"],
  } as const;
  function signal(
    id: string,
    metric: MetricKey,
    startValue: number,
    endValue: number,
    type: Signal["type"],
  ): string {
    const summary = {
      metric,
      startValue,
      endValue,
      delta: endValue - startValue,
      relativeDelta: null,
      observedCount: 3,
      missingCount: 0,
    };
    const sources = [hash("a"), hash("c")].map((snapshotHash) => ({
      snapshotHash,
      resultPath: `recorded.${metric.id}`,
      basis:
        metric.id === "economy.serializedBalance"
          ? ("serialized_ledger" as const)
          : ("persisted_aggregate" as const),
    }));
    data.summaries.push(summary);
    data.series.push({
      key: metric,
      temporalKind:
        metric.id === "economy.serializedBalance" ||
        metric.id === "stockpile.balance"
          ? "balance"
          : metric.id === "economy.productionDemand"
            ? "demand"
            : metric.id === "production.activeFactories"
              ? "allocation"
              : "state",
      unit:
        metric.id === "stockpile.balance"
          ? "equipment_units"
          : metric.id.startsWith("economy.")
            ? "resource_units"
            : "factories",
      observations: [hash("a"), hash("b"), hash("c")].map(
        (snapshotHash, index) => ({
          snapshotHash,
          sources: [{ ...sources[0], snapshotHash }],
          qualifiers: [],
          status: "observed" as const,
          value: index === 2 ? endValue : startValue,
        }),
      ),
    });
    data.evidence.push({
      id: `e-${id}`,
      layer: "derived_arithmetic",
      metric,
      sources,
      rawValues: [startValue, endValue, endValue - startValue],
      operation: "target_minus_base",
      inputEvidenceIds: [],
      qualifiers: [],
    });
    data.signals.push({
      id,
      ruleVersion: 1,
      type,
      metric,
      summary,
      evidenceIds: [`e-${id}`],
      confidence: { ...confidence, reasons: [...confidence.reasons] },
      ...(["positive_to_negative", "negative_to_nonnegative"].includes(type)
        ? { crossingBracket: { beforeHash: hash("a"), afterHash: hash("c") } }
        : {}),
    });
    return id;
  }
  const capacity = signal(
    "capacity",
    { id: "industry.effectiveMilitaryFactories", countryTag: "GER" },
    121,
    164,
    "increase",
  );
  const allocation = signal(
    "allocation",
    { id: "production.activeFactories", countryTag: "GER" },
    10,
    20,
    "increase",
  );
  const steel = signal(
    "steel",
    { id: "economy.serializedBalance", countryTag: "GER", resource: "steel" },
    43,
    -71,
    "positive_to_negative",
  );
  const demand = signal(
    "demand",
    { id: "economy.productionDemand", countryTag: "GER", resource: "steel" },
    100,
    120,
    "increase",
  );
  const rubber = signal(
    "rubber",
    { id: "economy.serializedBalance", countryTag: "GER", resource: "rubber" },
    -1,
    9.57792,
    "negative_to_nonnegative",
  );
  const rubberDemand = signal(
    "rubber-demand",
    { id: "economy.productionDemand", countryTag: "GER", resource: "rubber" },
    105,
    105,
    "maintained",
  );
  const equipmentDefinition = "modded__tank";
  const equipment = signal(
    "equipment-allocation",
    {
      id: "production.activeFactories",
      countryTag: "GER",
      equipmentDefinition,
    },
    2,
    4,
    "increase",
  );
  const stockpile = signal(
    "stockpile",
    { id: "stockpile.balance", countryTag: "GER", equipmentDefinition },
    10,
    -2.5,
    "positive_to_negative",
  );
  const add = (
    catalogId: InsightFamily,
    ids: string[],
    messageParams: Record<string, string | number> = {},
  ) =>
    data.insights.push({
      id: catalogId,
      catalogId,
      catalogVersion: 1,
      signalIds: ids,
      evidenceIds: ids.map((id) => `e-${id}`),
      messageKey: INSIGHT_MESSAGES[catalogId],
      messageParams: { countryTag: "GER", ...messageParams },
      confidence: { ...confidence, reasons: [...confidence.reasons] },
      severity:
        catalogId === "INDUSTRY_ALLOCATION_EXPANSION" ||
        catalogId === "RESOURCE_RECOVERY_WITH_MAINTAINED_DEMAND"
          ? "informational"
          : "attention",
      qualifiers: ["serialized_state_at_save_time"],
      causalClaim: false,
    });
  add("INDUSTRY_ALLOCATION_EXPANSION", [capacity, allocation]);
  add("INDUSTRIAL_EXPANSION_WITH_RESOURCE_CROSSING", [capacity, steel], {
    resource: "steel",
  });
  add("RESOURCE_PRESSURE_WITH_HIGHER_DEMAND", [demand, steel], {
    resource: "steel",
  });
  add("RESOURCE_RECOVERY_WITH_MAINTAINED_DEMAND", [rubber, rubberDemand], {
    resource: "rubber",
  });
  add("ALLOCATION_WITH_STOCKPILE_DECLINE", [equipment, stockpile], {
    equipmentDefinition,
  });
  add("EQUIPMENT_DEFICIT_DURING_ALLOCATION_EXPANSION", [equipment, stockpile], {
    equipmentDefinition,
  });
  return data;
}

/** Observed acceptance window, plus a faithful nine-record dependency graph. */
export function acceptanceFixture(legacyEndpoints = 2) {
  const data = intelligenceFixture();
  const campaign = campaignFixture();
  campaign.snapshots = [campaign.snapshots[0], campaign.snapshots[2]];
  campaign.snapshots[0].gameDate = "1944.4.1";
  campaign.snapshots[1].gameDate = "1944.5.1";
  data.window.baseGameDate = "1944.4.1";
  data.window.targetGameDate = "1944.5.1";
  data.window.snapshotHashes = [hash("a"), hash("c")];
  data.insights = [data.insights[0]];
  data.signals = data.signals.slice(0, 2);
  data.evidence = [];
  for (const [index, signal] of data.signals.entries()) {
    const [startValue, endValue, delta] =
      index === 0 ? [280, 286, 6] : [285, 292, 7];
    Object.assign(signal.summary, {
      startValue,
      endValue,
      delta,
      observedCount: 2,
    });
    signal.evidenceIds = [`${signal.id}-signal`];
    const facts = [startValue, endValue].map((value, endpoint) => ({
      id: `${signal.id}-fact-${endpoint}`,
      layer: "persisted_fact" as const,
      metric: signal.metric,
      sources: [
        {
          snapshotHash: hash(endpoint ? "c" : "a"),
          resultPath: `recorded.${signal.metric.id}`,
          basis: "persisted_aggregate" as const,
        },
      ],
      rawValues: [value],
      operation: "read_projection",
      inputEvidenceIds: [],
      qualifiers: [
        "serialized_state_at_save_time",
        "allocation_is_not_realized_output",
      ],
    }));
    data.evidence.push(
      ...facts,
      {
        id: `${signal.id}-delta`,
        layer: "derived_arithmetic",
        metric: signal.metric,
        sources: facts.flatMap((fact) => fact.sources),
        rawValues: [startValue, endValue, delta],
        operation: "target_minus_base",
        inputEvidenceIds: facts.map((fact) => fact.id),
        qualifiers: ["serialized_state_at_save_time"],
      },
      {
        id: `${signal.id}-signal`,
        layer: "temporal_signal",
        metric: signal.metric,
        sources: facts.flatMap((fact) => fact.sources),
        rawValues: [startValue, endValue, delta],
        operation: "increase",
        inputEvidenceIds: [`${signal.id}-delta`],
        qualifiers: ["serialized_state_at_save_time"],
      },
    );
  }
  data.evidence.push({
    id: "co-occurrence",
    layer: "co_occurrence",
    sources: [],
    rawValues: [],
    operation: "and_endpoint_signals",
    inputEvidenceIds: data.signals.map((signal) => `${signal.id}-signal`),
    qualifiers: ["serialized_state_at_save_time"],
  });
  data.insights[0].evidenceIds = ["co-occurrence"];
  data.summaries = data.signals.map((signal) => signal.summary);
  data.series = data.series.slice(0, 2).map((series, index) => ({
    ...series,
    observations: [hash("a"), hash("c")].map((snapshotHash, endpoint) => ({
      snapshotHash,
      sources: [],
      qualifiers: [],
      status: "observed" as const,
      value: endpoint
        ? data.signals[index].summary.endValue!
        : data.signals[index].summary.startValue!,
    })),
  }));
  data.coverageIssues.push({ code: "available_authorized_history_only" });
  for (const [id, count] of [
    ["production.activeFactories", 11],
    ["stockpile.balance", 14],
  ] as const) {
    for (let i = 0; i < count; i++)
      data.coverageIssues.push({
        code: "metric_absent",
        metric: {
          id,
          countryTag: "GER",
          equipmentDefinition:
            i === 0
              ? "modded__tank"
              : i === 1
                ? "modded_tank"
                : `equipment_${i}`,
        },
        snapshotHash: hash("a"),
      });
  }
  for (const endpoint of ["a", "c"].slice(0, legacyEndpoints)) {
    for (const resource of [
      "aluminium",
      "rubber",
      "tungsten",
      "steel",
      "chromium",
      "coal",
    ] as const) {
      for (const id of [
        "economy.productionDemand",
        "economy.serializedBalance",
      ] as const)
        data.coverageIssues.push({
          code: "metric_legacy",
          metric: { id, countryTag: "GER", resource },
          snapshotHash: hash(endpoint),
        });
    }
  }
  return { data, campaign };
}
