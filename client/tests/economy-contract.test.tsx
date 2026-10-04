import { expect, test } from "vitest";
import { ECONOMY_RESOURCES, type EconomyAnalysis } from "../src/types/economy";
import {
  ECONOMY_RESOURCES as SERVER_RESOURCES,
  type EconomyAnalysis as BackendEconomyAnalysis,
} from "../../server/src/hoi4/economy/economy.types";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
// Explicit tsc validation of this file catches nested contract/nullable drift.
const exactContract: Equal<EconomyAnalysis, BackendEconomyAnalysis> = true;
test("client Economy contract matches Phase 2A including resource identifiers", () => {
  expect(exactContract).toBe(true);
  expect(ECONOMY_RESOURCES).toEqual(SERVER_RESOURCES);
});
