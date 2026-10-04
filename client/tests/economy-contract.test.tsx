import { expect, test } from "vitest";
import { ECONOMY_RESOURCES, type EconomyAnalysis } from "../src/types/economy";
import {
  ECONOMY_RESOURCES as SERVER_RESOURCES,
  type EconomyAnalysis as BackendEconomyAnalysis,
} from "../../server/src/hoi4/economy/economy.types";
import type { AnalysisComparisonDto } from "../src/types/analysis-comparison";
import type { AnalysisComparisonDto as BackendComparison } from "../../server/src/analyze/analysis-comparison.types";
import type { CampaignTrendsDto } from "../src/types/campaign-trends";
import type { CampaignTrendsDto as BackendTrends } from "../../server/src/analyze/campaign-trends.types";
import type { EconomyLedger } from "../src/types/economy";
import type { EconomyLedger as BackendLedger } from "../../server/src/analyze/economy-ledger-projection";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
// Explicit tsc validation of this file catches nested contract/nullable drift.
const exactContract: Equal<EconomyAnalysis, BackendEconomyAnalysis> = true;
const comparisonContract: Equal<AnalysisComparisonDto, BackendComparison> =
  true;
const trendsContract: Equal<CampaignTrendsDto, BackendTrends> = true;
const ledgerContract: Equal<EconomyLedger, BackendLedger> = true;
test("client Economy contract matches Phase 2A including resource identifiers", () => {
  expect(exactContract).toBe(true);
  expect([comparisonContract, trendsContract, ledgerContract]).toEqual([
    true,
    true,
    true,
  ]);
  expect(ECONOMY_RESOURCES).toEqual(SERVER_RESOURCES);
});
