import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CountryProductionDetails } from "../src/components/analyzer/CountryProductionDetails";
import type {
  CountryMilitaryProductionSummary,
  MilitaryProductionDefinitionSummary,
} from "../src/types";

const definition = (
  equipmentDefinition: string,
  activeFactories: number,
): MilitaryProductionDefinitionSummary => ({
  equipmentDefinition,
  lineCount: 1,
  requestedFactories: activeFactories,
  activeFactories,
  queuedFactories: 0,
  damagedFactories: 0,
  currentItemsPerDay: 1,
  knownCurrentItemsPerDay: 1,
  outputComplete: true,
  resourceShortageLineCount: 0,
  lines: [],
});

const definitions = [
  definition("beta_equipment", 2),
  definition("zeta_equipment", 5),
  definition("alpha_equipment", 2),
];

const country: CountryMilitaryProductionSummary = {
  countryTag: "GER",
  lineCount: 3,
  definitionCount: 3,
  requestedFactories: 9,
  activeFactories: 9,
  queuedFactories: 0,
  damagedFactories: 0,
  resourceShortageLineCount: 0,
  definitions,
  unresolvedLines: [],
};

const reconciliationNote =
  "Effective military factories and production-line factory slots are separate save concepts and do not necessarily reconcile.";

describe("Production country details", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = async (
    effectiveMilitaryFactories: number | null,
    onSelectDefinition = vi.fn(),
  ) => {
    await act(async () =>
      root.render(
        <CountryProductionDetails
          country={country}
          selectedDefinition={definitions[0]}
          effectiveMilitaryFactories={effectiveMilitaryFactories}
          onSelectDefinition={onSelectDefinition}
        />,
      ),
    );
    return onSelectDefinition;
  };

  test("renders effective MIL and the non-reconciliation explanation once", async () => {
    await render(286);

    const summary = [...container.querySelectorAll(".production-summary-grid > div")]
      .find((item) => item.querySelector("dt")?.textContent === "Effective MIL factories");
    expect(summary?.querySelector("dd")?.textContent).toBe("286");
    expect(container.textContent?.split(reconciliationNote)).toHaveLength(2);
  });

  test("renders unavailable effective MIL as a dash rather than zero", async () => {
    await render(null);

    const summary = [...container.querySelectorAll(".production-summary-grid > div")]
      .find((item) => item.querySelector("dt")?.textContent === "Effective MIL factories");
    expect(summary?.querySelector("dd")?.textContent).toBe("—");
  });

  test("sorts definitions by active factories then definition and preserves selection identity", async () => {
    const onSelectDefinition = await render(286);
    const rows = [
      ...container.querySelectorAll<HTMLTableRowElement>(
        ".production-definition-table tbody tr",
      ),
    ];

    expect(rows.map((row) => row.querySelector(".production-code")?.textContent)).toEqual([
      "zeta_equipment",
      "alpha_equipment",
      "beta_equipment",
    ]);

    await act(async () => rows[1].click());
    expect(onSelectDefinition).toHaveBeenCalledWith("alpha_equipment");
    expect(country.definitions).toEqual(definitions);
  });
});
