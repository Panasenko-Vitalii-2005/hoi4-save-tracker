import type { SaveRecord, XMode } from "@/types";

// Keep only country-focused numeric metrics here. Performance/write metrics
// were moved to non-used/client_performance_legacy.ts for archival.
export const NUMERIC_METRICS = [
  "divisions",
  "army_groups",
  "ships",
  "planes",
  "active_countries",
] as const;

// Presets focus on country analysis. Performance-related presets were
// moved to non-used/client_performance_legacy.ts.
export const PRESETS = {
  "Military Growth": {
    metrics: [
      "divisions",
      "army_groups",
      "ships",
      "planes",
      "active_countries",
    ],
    xMode: "game_date" as XMode,
    maWindow: 1,
    normalize: false,
    uniqueGameDateOnly: true,
    separateScale: true,
    description: "In-game force growth by game date.",
  },
  "Compare Trends": {
    metrics: ["divisions", "ships", "planes"],
    xMode: "game_date" as XMode,
    maWindow: 3,
    normalize: true,
    uniqueGameDateOnly: true,
    separateScale: false,
    description: "Normalized multi-metric trend comparison (country-focused).",
  },
  "Duplicate Finder": {
    metrics: ["divisions", "army_groups", "ships"],
    xMode: "real_time" as XMode,
    maWindow: 1,
    normalize: false,
    uniqueGameDateOnly: false,
    separateScale: false,
    description: "Keep duplicate game_date records visible for diagnostics.",
  },
} as const;

export function movingAverage(values: number[], window: number): number[] {
  if (window <= 1) return [...values];
  const out: number[] = [];
  let rolling = 0;
  values.forEach((v, i) => {
    rolling += v;
    if (i >= window) rolling -= values[i - window];
    out.push(rolling / Math.min(window, i + 1));
  });
  return out;
}

export function normalizeSeries(values: number[]): number[] {
  if (!values.length) return values;
  const min = Math.min(...values),
    max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

export function buildXAxis(records: SaveRecord[], mode: XMode) {
  if (mode === "save_index")
    return { xValues: records.map((_, i) => i + 1), xTitle: "Save index" };
  if (mode === "real_time")
    return {
      xValues: records.map((r, i) => r.real_time ?? String(i + 1)),
      xTitle: "Real time",
    };
  return {
    xValues: records.map((r, i) => r.game_date ?? String(i + 1)),
    xTitle: "Game date",
  };
}

export function filterUniqueByDate(records: SaveRecord[]): SaveRecord[] {
  const byDate = new Map<string, SaveRecord>();
  const noDate: SaveRecord[] = [];
  for (const rec of records) {
    if (!rec.game_date) {
      noDate.push(rec);
      continue;
    }
    byDate.set(rec.game_date, rec);
  }
  const dated = Array.from(byDate.values()).sort((a, b) =>
    (a.real_time ?? "").localeCompare(b.real_time ?? ""),
  );
  return [...noDate, ...dated];
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !isFinite(v)) return "—";
  return Number(v).toFixed(digits).replace(/\.00$/, "");
}

export function fmtBig(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export function shortEqName(name: string): string {
  return name
    .replace(/_equipment_/g, " Eq ")
    .replace(/_/g, " ")
    .replace(/\b(\w)/g, (c) => c.toUpperCase());
}

export const COUNTRY_NAMES: Record<string, string> = {
  GER: "Germany",
  SOV: "Soviet Union",
  ENG: "United Kingdom",
  FRA: "France",
  USA: "United States",
  ITA: "Italy",
  JPN: "Japan",
  CHI: "China",
  CAN: "Canada",
  BEL: "Belgium",
  NED: "Netherlands",
  SWE: "Sweden",
  NOR: "Norway",
  DNK: "Denmark",
  POL: "Poland",
  HUN: "Hungary",
  ROU: "Romania",
  BUL: "Bulgaria",
  FIN: "Finland",
  TUR: "Turkey",
  YUG: "Yugoslavia",
  GRE: "Greece",
  SPA: "Spain",
  POR: "Portugal",
  BRA: "Brazil",
  ARG: "Argentina",
  PER: "Peru",
  MEX: "Mexico",
  RUS: "Russia",
  CZE: "Czech Republic",
  AUS: "Austria",
};

export function countryFullName(tag: string): string {
  return COUNTRY_NAMES[tag.toUpperCase()] ?? tag;
}

const SETTINGS_KEY = "hoi4-dashboard-v1";
export function loadSettings<T>(defaults: T): T {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}
export function saveSettings(data: object): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}
