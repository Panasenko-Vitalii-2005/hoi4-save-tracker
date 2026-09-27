import { act } from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { StockpileTab } from "../src/components/analyzer/StockpileTab";
import { i18n } from "../src/i18n";
import type { CountryStockpileSummary, StockpileDefinitionSummary } from "../src/types";

const definition = (
  equipment: string,
  amount: number,
  variants: StockpileDefinitionSummary["variants"] = [],
): StockpileDefinitionSummary => ({ definition: equipment, amount, variants });

const countries: CountryStockpileSummary[] = [
  {
    countryTag: "GER",
    definitions: [definition("artillery_equipment_3", 13_478)],
    unresolvedVariants: [],
  },
  {
    countryTag: "USA",
    definitions: [
      definition("anti_air_equipment_1", 934),
      definition("anti_air_equipment_2", 4_685, [
        {
          equipmentRef: { type: 52, id: 1 },
          definition: "anti_air_equipment_2",
          variantName: null,
          amount: 4_650,
          version: 1,
          creatorTag: "USA",
          originTag: "USA",
          obsolete: false,
        },
        {
          equipmentRef: { type: 52, id: 2 },
          definition: "anti_air_equipment_2",
          variantName: null,
          amount: 33,
          version: null,
          creatorTag: "JAP",
          originTag: "JAP",
          obsolete: false,
        },
        {
          equipmentRef: { type: 52, id: 3 },
          definition: "anti_air_equipment_2",
          variantName: null,
          amount: 1,
          version: null,
          creatorTag: "ENG",
          originTag: "ENG",
          obsolete: false,
        },
        {
          equipmentRef: { type: 52, id: 4 },
          definition: "anti_air_equipment_2",
          variantName: null,
          amount: 1,
          version: null,
          creatorTag: "HUN",
          originTag: "HUN",
          obsolete: false,
        },
      ]),
      definition("convoy_1", -24),
    ],
    unresolvedVariants: [],
  },
];

function setSearch(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("National Stockpile presentation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await i18n.changeLanguage("ru");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(
      <StockpileTab summaries={countries} preferredCountryTag="USA" />,
    ));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    await i18n.changeLanguage("en");
    vi.unstubAllGlobals();
  });

  test("shows a positive balance normally and a negative balance as a deficit", () => {
    const rows = [...container.querySelectorAll<HTMLTableRowElement>(
      ".stockpile-definition-table > tbody > tr:not(.stockpile-variant-expansion)",
    )];
    expect(rows.find((row) => row.textContent?.includes("anti_air_equipment_1"))?.textContent).toContain("934");
    const convoy = rows.find((row) => row.textContent?.includes("convoy_1"));
    expect(convoy?.querySelector(".stockpile-deficit")?.textContent).toBe("Дефицит 24");
    expect(convoy?.textContent).not.toContain("-24");
    expect(countries[1].definitions[2].amount).toBe(-24);
    expect(container.textContent).toContain("Баланс");
    expect(container.textContent).toContain("3 типа");
    expect(container.textContent).toContain("4 варианта");
  });

  test("searches display names and raw IDs without changing the country", async () => {
    const input = container.querySelector<HTMLInputElement>(".stockpile-search input")!;
    await act(async () => setSearch(input, "Improved Anti-Air"));
    expect(container.querySelectorAll(".stockpile-definition-table > tbody > tr")).toHaveLength(1);
    expect(container.textContent).toContain("anti_air_equipment_2");

    await act(async () => setSearch(input, "ANTI_AIR_EQUIPMENT_1"));
    expect(container.querySelectorAll(".stockpile-definition-table > tbody > tr")).toHaveLength(1);
    expect(container.textContent).toContain("anti_air_equipment_1");
    expect(container.querySelector(".stockpile-country-table tr.selected")?.textContent).toContain("USA");

    await act(async () => setSearch(input, "no matching equipment"));
    expect(container.textContent).toContain("По запросу не найдено типов оснащения.");
    expect(container.querySelector(".stockpile-country-table tr.selected")?.textContent).toContain("USA");
  });

  test("expands exact variants only on request and keeps selection separate from deficit styling", async () => {
    expect(container.querySelector(".stockpile-variant-expansion")).toBeNull();
    const button = [...container.querySelectorAll<HTMLButtonElement>(".stockpile-expand-button")]
      .find((item) => item.textContent?.includes("anti_air_equipment_2"))!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await act(async () => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const selected = button.closest("tr")!;
    expect(selected.classList.contains("selected")).toBe(true);
    expect(selected.querySelector(".stockpile-deficit")).toBeNull();
    expect(container.querySelector(".stockpile-variant-expansion")?.textContent)
      .toContain("40 mm Automatic Gun M1");
    const variantRows = [...container.querySelectorAll<HTMLTableRowElement>(
      ".stockpile-variant-table tbody tr",
    )];
    expect(variantRows.map((row) => row.querySelector(".design-cell")?.textContent))
      .toEqual([
        "40 mm Automatic Gun M1",
        "Type 2 20 mm",
        "QF 40 mm Bofors",
        "Improved Anti-Air",
      ]);
    expect(variantRows.map((row) => row.querySelector(".numeric-cell")?.textContent))
      .toEqual(["4,650", "33", "1", "1"]);
    expect(countries[1].definitions[1].variants.every((variant) => variant.variantName === null))
      .toBe(true);
    await act(async () => button.click());
    expect(container.querySelector(".stockpile-variant-expansion")).toBeNull();
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/stockpile-definition-table tbody tr\.selected td:first-child\s*\{\s*box-shadow: inset 3px 0 var\(--accent-3\)/);
  });

  test("keeps country selection functional and provides English copy", async () => {
    const germany = [...container.querySelectorAll<HTMLTableRowElement>(".stockpile-country-table tbody tr")]
      .find((row) => row.textContent?.includes("GER"))!;
    await act(async () => germany.click());
    expect(container.querySelector(".stockpile-country-table tr.selected")?.textContent).toContain("GER");
    expect(container.textContent).toContain("artillery_equipment_3");
    await act(async () => i18n.changeLanguage("en"));
    expect(container.textContent).toContain("Balance");
    expect(container.textContent).toContain("1 type");
  });
});
