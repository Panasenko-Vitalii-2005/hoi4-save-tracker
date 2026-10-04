/** Presentation only: never feeds formatted numbers back into the save model. */
export function formatEconomyNumber(
  value: number | null | undefined,
  locale: string,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
    value,
  );
}

export function formatEconomyEfficiency(
  value: number | null | undefined,
  locale: string,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(value);
}

/** Exact JS numeric value received from the backend, without UI rounding. */
export function rawEconomyValue(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : String(value);
}
