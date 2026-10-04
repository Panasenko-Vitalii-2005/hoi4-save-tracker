import type { AnalyzeResult } from '../hoi4/hoi4-parser';
import {
  ECONOMY_RESOURCES,
  type EconomyResource,
} from '../hoi4/economy/economy.types';

export const ECONOMY_LEDGER_METRICS = [
  'extracted',
  'imported',
  'exportAllocation',
  'projectDemand',
  'productionDemand',
  'serializedBalance',
] as const;
export type EconomyLedgerMetric = (typeof ECONOMY_LEDGER_METRICS)[number];
export type EconomyLedger = Record<
  EconomyResource,
  Record<EconomyLedgerMetric, number | null>
>;

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Compact national-only projection: no reconciliation, trade sums or rights attribution. */
export function projectEconomyLedgers(
  result: AnalyzeResult,
): Map<string, EconomyLedger> {
  return new Map(
    (result.economy?.countrySummaries ?? []).map((country) => {
      const resources = new Map(
        country.resources.map((row) => [row.resource, row]),
      );
      const ledger = Object.fromEntries(
        ECONOMY_RESOURCES.map((resource) => {
          const row = resources.get(resource);
          return [
            resource,
            {
              extracted: finite(row?.extracted),
              imported: finite(row?.imported),
              exportAllocation: finite(row?.exportAllocation),
              projectDemand: finite(row?.projectDemand),
              productionDemand: finite(row?.productionDemand.total),
              serializedBalance: finite(row?.serializedBalance),
            },
          ];
        }),
      ) as EconomyLedger;
      return [country.countryTag, ledger];
    }),
  );
}
