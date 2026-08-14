export interface SaveRecord {
  real_time: string;
  game_date: string | null;
  file_size_bytes: number;
  file_size_mb: number;
  write_duration_seconds: number;
  write_speed_mb_per_sec: number | null;
  cpu_avg: number | null;
  cpu_max: number | null;
  ram_avg: number | null;
  ram_max: number | null;
  resource_samples: number;
  divisions: number;
  army_groups: number;
  ships: number;
  planes: number;
  active_countries: number;
  parse_seconds: number;
  interval_seconds: number | null;
  interval_human: string | null;
  game_days_passed: number | null;
  seconds_per_game_day: number | null;
  soldiers_by_country?: Record<string, SoldiersEntry> | null;
}
export interface SoldiersEntry {
  divisions: number;
  manpower: number;
  avg_manpower: number;
}
export interface SoldiersApiResponse {
  tags: string[];
  timeline: SoldiersTimelineEntry[];
  latest_ranked: (SoldiersEntry & { tag: string })[];
}
export interface SoldiersTimelineEntry {
  game_date: string | null;
  real_time: string | null;
  [tag: string]: SoldiersEntry | string | null;
}

/**
 * Single source-of-truth model for per-country statistics.
 * Adding a new metric: add it here → fill in the parser → consume in UI.
 */
export interface CountryWarCasualties {
  opponentTag: string;
  startDate: string | null;
  role: "first" | "second";
  casualties: number;
}

export interface CountryStats {
  tag: string;
  // Land forces
  divisions: number;
  manpowerInField: number; // active manpower from army_manpower_value
  manpowerCasualties: number | null;
  warCasualties: CountryWarCasualties[];
  calculatedWarCasualtiesTotal?: number;
  // Air force
  aircraft: number; // planes in air_wing_pool
  // Navy
  ships: number; // ship= entries in task_forces
  // Industry (from states block)
  militaryFactories: number; // arms_factory buildings
  civilianFactories: number; // industrial_complex buildings
  dockyards: number; // dockyard buildings
}

export interface ParsedWarCasualties {
  firstTag: string | null;
  secondTag: string | null;
  startDate: string | null;
  firstCasualties: number | null;
  secondCasualties: number | null;
  parentTag: string | null;
  sourceOffset: number;
  wargoalIds: number[];
}

export interface NavalLossTypeCount {
  definition: string;
  count: number;
}

export interface NavalLossAttribution {
  role: "primary_observed" | "assistant" | "alternative" | "unresolved";
  killerName: string | null;
  killerCountryTag: string | null;
}

export interface NavalLossEvent {
  sunkShip: {
    name: string | null;
    countryTag: string | null;
    definition: string | null;
  };
  event: {
    date: string | null;
  };
  attributions: NavalLossAttribution[];
}

export interface CountryNavalLossSummary {
  countryTag: string | null;
  totalLost: number;
  byType: NavalLossTypeCount[];
}

export interface CreditedKillerShipIdentity {
  id: number;
  type: number;
}

export interface CreditedKillerShip {
  name: string | null;
  definition: string | null;
  identity: CreditedKillerShipIdentity | null;
}

export interface CreditedNavalKill {
  eventId: string;
  sunkShip: {
    countryTag: string | null;
    name: string | null;
    definition: string | null;
  };
  event: {
    date: string | null;
  };
  killerCountryTag: string;
  killerShip: CreditedKillerShip | null;
  shipCreditResolved: boolean;
}

export interface CountryNavalKillSummary {
  countryTag: string;
  creditedKills: number;
  byVictimType: NavalLossTypeCount[];
}

export interface NavalKillerShipSummary {
  countryTag: string;
  shipId: CreditedKillerShipIdentity;
  shipName: string | null;
  shipDefinition: string | null;
  creditedKills: number;
}

export interface EquipmentRef {
  id: number;
  type: number;
}

export interface StockpileVariantSummary {
  equipmentRef: EquipmentRef;
  definition: string;
  variantName: string | null;
  amount: number;
  version: number | null;
  creatorTag: string | null;
  originTag: string | null;
  obsolete: boolean;
}

export interface UnresolvedStockpileVariantSummary {
  equipmentRef: EquipmentRef | null;
  amount: number;
}

export interface StockpileDefinitionSummary {
  definition: string;
  amount: number;
  variants: StockpileVariantSummary[];
}

export interface CountryStockpileSummary {
  countryTag: string;
  definitions: StockpileDefinitionSummary[];
  unresolvedVariants: UnresolvedStockpileVariantSummary[];
}

/** World totals — same shape as CountryStats minus the tag. */
export type CountryTotals = Omit<CountryStats, "tag">;

export interface AnalyzeResult {
  game_date: string;
  file_size_mb: number;
  parse_seconds: number;
  active_countries: number;
  totals: CountryTotals;
  by_country: CountryStats[];
  equipment_by_country: Record<string, Record<string, number>>;
  world_equipment: Record<string, number>;
  stockpileSummaries: CountryStockpileSummary[];
  navalLosses: NavalLossEvent[];
  navalLossSummaries: CountryNavalLossSummary[];
  navalKills: CreditedNavalKill[];
  navalKillSummaries: CountryNavalKillSummary[];
  navalKillerShipSummaries: NavalKillerShipSummary[];
  calculatedWarCasualtiesTotal?: number;
  warCasualties?: ParsedWarCasualties[];
}

export type TabId = "chart" | "soldiers" | "analyzer";
export type XMode = "save_index" | "real_time" | "game_date";
export interface Preset {
  metrics: string[];
  xMode: XMode;
  maWindow: number;
  normalize: boolean;
  uniqueGameDateOnly: boolean;
  separateScale: boolean;
  description: string;
}
