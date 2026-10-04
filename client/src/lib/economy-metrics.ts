import {
  ECONOMY_RESOURCES,
  ECONOMY_LEDGER_METRICS,
  type EconomyLedgerMetric,
  type EconomyTrendMetric,
} from "@/types/economy";
import type {
  CampaignTrendSnapshot,
  TrendMetric,
} from "@/types/campaign-trends";

export const ECONOMY_METRIC_LABEL_KEYS: Record<EconomyLedgerMetric, string> = {
  extracted: "economy.extracted",
  imported: "economy.imported",
  exportAllocation: "economy.exported",
  projectDemand: "economy.projects",
  productionDemand: "economy.production",
  serializedBalance: "economy.balance",
};
const COLORS = [
  "#4d8fd6",
  "#2aa198",
  "#d49a45",
  "#8d77d8",
  "#c96767",
  "#6da7a3",
];
export const ECONOMY_TREND_METRICS = ECONOMY_RESOURCES.flatMap(
  (resource, index) =>
    ECONOMY_LEDGER_METRICS.map((metric, metricIndex) => ({
      key: `economy.${resource}.${metric}` as EconomyTrendMetric,
      resource,
      metric,
      // Distinct colors both within one resource and across the balance preset.
      color: COLORS[(index + metricIndex) % COLORS.length],
      global: false,
      country: true,
    })),
);
export const ECONOMY_BALANCE_METRICS = ECONOMY_TREND_METRICS.filter(
  ({ metric }) => metric === "serializedBalance",
).map(({ key }) => key);

export function economyMetricDefinition(key: TrendMetric) {
  return ECONOMY_TREND_METRICS.find((metric) => metric.key === key);
}

export function economyTrendValue(
  snapshot: CampaignTrendSnapshot,
  countryTag: string,
  key: TrendMetric,
): number | null {
  const definition = economyMetricDefinition(key);
  if (!definition) return null;
  const value = snapshot.countries.find(({ tag }) => tag === countryTag)
    ?.economy?.[definition.resource]?.[definition.metric];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
