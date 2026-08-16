import type { EquipmentRef, SaveRecord, XMode } from "@/types";

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

const STOCKPILE_AMOUNT_FORMATTER = new Intl.NumberFormat("en-US", {
  useGrouping: true,
  maximumFractionDigits: 15,
});

export function formatStockpileAmount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return STOCKPILE_AMOUNT_FORMATTER.format(value);
}

export function equipmentReferenceKey(
  reference: EquipmentRef | null | undefined,
): string | null {
  return reference ? `${reference.type}:${reference.id}` : null;
}

const DIVISION_RATIO_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

export function formatDivisionRatio(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return DIVISION_RATIO_FORMATTER.format(value);
}

export function formatEquipmentDefinition(definition: string): string {
  const readable = definition.trim().replace(/_+/g, " ");
  if (!readable) return definition;
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

const PRODUCTION_RATE_FORMATTER = new Intl.NumberFormat("en-US", {
  useGrouping: true,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PRODUCTION_VALUE_FORMATTER = new Intl.NumberFormat("en-US", {
  useGrouping: true,
  maximumFractionDigits: 2,
});

const PRODUCTION_PROGRESS_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

export function formatProductionRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return PRODUCTION_RATE_FORMATTER.format(value);
}

export function formatProductionValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return PRODUCTION_VALUE_FORMATTER.format(value);
}

export function formatProductionProgress(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return PRODUCTION_PROGRESS_FORMATTER.format(value);
}

export interface Hoi4DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
}

export function parseHoi4Date(
  value: string | null | undefined,
): Hoi4DateParts | null {
  if (!value) return null;
  const match = /^(\d{1,4})\.(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/.exec(value);
  if (!match) return null;

  let [year, month, day, hour] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || hour < 0 || hour > 24) {
    return null;
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (day < 1 || day > daysInMonth[month - 1]) return null;

  if (hour === 24) {
    hour = 0;
    day++;
    if (day > daysInMonth[month - 1]) {
      day = 1;
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }
  }

  return { year, month, day, hour };
}

export function formatHoi4Date(value: string | null | undefined): string {
  const parsed = parseHoi4Date(value);
  if (!parsed) return "Unknown";
  return `${String(parsed.day).padStart(2, "0")}.${String(parsed.month).padStart(2, "0")}.${String(parsed.year).padStart(4, "0")}`;
}

export function navalShipTypeLabel(
  definition: string | null | undefined,
): string {
  const readable = definition?.trim().replace(/_+/g, " ") ?? "";
  if (!readable) return "Unknown";
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

export {
  getCountryDisplayName as countryFullName,
  formatCountryDisplayName,
} from "./countryNames";

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
