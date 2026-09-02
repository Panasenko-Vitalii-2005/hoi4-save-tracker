import type { NumericDiff } from "@/types/analysis-comparison";

const EXACT_NUMBER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 15,
});
const COMPACT_NUMBER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function formatReportNumber(
  value: number | null | undefined,
  compact = false,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return (compact ? COMPACT_NUMBER : EXACT_NUMBER).format(value);
}

export function formatReportDelta(
  value: number | null | undefined,
  compact = false,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${formatReportNumber(Math.abs(value), compact)}`;
}

export function formatReportDate(value: string | null | undefined): string {
  const match = /^(\d{1,4})\.(\d{1,2})\.(\d{1,2})(?:\.\d{1,2})?$/.exec(
    value ?? "",
  );
  if (!match) return "Unknown date";
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31)
    return "Unknown date";
  return `${day} ${MONTHS[month - 1]} ${match[1]}`;
}

export function diffStatus(diff: NumericDiff): string {
  if (diff.before === null && diff.after !== null) return "Target only";
  if (diff.before !== null && diff.after === null) return "Base only";
  return "Available in both";
}

export function finiteValues(
  values: readonly (number | null | undefined)[],
): number[] {
  return values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
}
