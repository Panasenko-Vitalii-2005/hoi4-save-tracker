import type { EquipmentRef } from "@/types";

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
