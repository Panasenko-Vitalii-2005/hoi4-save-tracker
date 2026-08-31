export interface CampaignTrendMetrics {
  activeCountries: number | null;
  divisions: number | null;
  manpowerInField: number | null;
  aircraft: number | null;
  ships: number | null;
  militaryFactories: number | null;
  civilianFactories: number | null;
  dockyards: number | null;
}

export interface CountryTrendMetrics {
  divisions: number | null;
  manpowerInField: number | null;
  aircraft: number | null;
  ships: number | null;
  militaryFactories: number | null;
  civilianFactories: number | null;
  dockyards: number | null;
  calculatedCasualties: number | null;
}

export interface CampaignTrendSnapshot {
  hash: string;
  fileName: string;
  gameDate: string;
  analyzedAt: string;
  gameVersion: string | null;
  metrics: CampaignTrendMetrics;
  countries: { tag: string; metrics: CountryTrendMetrics }[];
}

export interface CampaignTrend {
  key: string;
  campaignId: string | null;
  relationship: "known" | "unknown";
  snapshotCount: number;
  firstGameDate: string | null;
  latestGameDate: string | null;
  gameVersions: string[];
  snapshots: CampaignTrendSnapshot[];
}

export interface CampaignTrendsDto {
  snapshotCount: number;
  campaigns: CampaignTrend[];
}

export type GlobalTrendMetric = keyof CampaignTrendMetrics;
export type CountryTrendMetric = keyof CountryTrendMetrics;
export type TrendMetric = GlobalTrendMetric | CountryTrendMetric;
