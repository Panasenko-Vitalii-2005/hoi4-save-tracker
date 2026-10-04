import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EconomyTab } from "../src/components/analyzer/EconomyTab";
import { AnalyzerTab } from "../src/components/analyzer/AnalyzerTab";
import { i18n } from "../src/i18n";
import {
  formatEconomyNumber,
  rawEconomyValue,
} from "../src/lib/economy-display";
import type { AnalyzeResult } from "../src/types";
import type { EconomyAnalysis } from "../src/types/economy";
// Test-only reuse of Phase 2A fixtures/contract. Production bundles are client-only.
import { parseEconomy } from "../../server/src/hoi4/economy/economy.parser";
import { economyFixture } from "../../server/src/hoi4/economy/fixtures/economy.fixture";

vi.mock("react-plotly.js", () => ({ default: () => <div /> }));
vi.mock("@/hooks/useRecords", () => ({
  useRecords: () => ({
    records: [],
    loading: false,
    error: null,
    reload: () => {},
  }),
}));

function Harness({
  economy,
  preferred = "GER",
}: {
  economy?: EconomyAnalysis;
  preferred?: string | null;
}) {
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  return (
    <EconomyTab
      economy={economy}
      preferredCountryTag={preferred}
      selectedTag={selectedTag}
      onSelectedTagChange={setSelectedTag}
    />
  );
}

describe("serialized Economy presentation", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    await i18n.changeLanguage("en");
  });
  const render = async (
    economy: EconomyAnalysis | undefined = parseEconomy(economyFixture()),
  ) => {
    await act(async () => root.render(<Harness economy={economy} />));
  };
  const row = (resource: string) =>
    container.querySelector<HTMLTableRowElement>(
      `tr[data-resource="${resource}"]`,
    )!;
  const values = (resource: string) =>
    [...row(resource).querySelectorAll("td")].map((cell) => cell.textContent);
  const expand = async (resource: string) => {
    await act(async () => row(resource).querySelector("button")!.click());
  };

  test("renders the six supported resources and the backend ledger without recomputing it", async () => {
    await render();
    expect(
      [...container.querySelectorAll("tr[data-resource]")].map(
        (element) =>
          element.textContent?.split("▸")[1]?.match(/^[A-Za-z]+/)?.[0],
      ),
    ).toEqual(["Aluminium", "Rubber", "Tungsten", "Steel", "Chromium", "Coal"]);
    expect(values("steel")).toEqual(["897", "—", "160", "28", "773", "-64"]);
    expect(
      row("steel").lastElementChild?.classList.contains("economy-negative"),
    ).toBe(true);
    expect(values("tungsten")).toEqual(["12", "48", "8", "10", "137", "-95"]);
    // Allocation 62.1 differs from savedExported 56 and displayed UI integer 62.
    expect(values("aluminium")).toEqual([
      "414",
      "—",
      "62.1",
      "—",
      "187",
      "165",
    ]);
    expect(values("coal")).toEqual(["611", "—", "96", "—", "467", "48"]);
    expect(container.textContent).not.toMatch(/Oil|Fuel/);
  });

  test("distinguishes null from explicit zero and leaves unknown route/partner data unknown", async () => {
    const economy = parseEconomy(economyFixture());
    economy.countrySummaries[0].resources[0].imported = 0;
    const trade = economy.commercialTrades.find(
      (entry) => entry.resource === "tungsten",
    )!;
    trade.importerTag = null;
    trade.route = null;
    await act(async () =>
      root.render(<Harness economy={economy} preferred="POR" />),
    );
    await expand("tungsten");
    expect(
      container.querySelector(".economy-trades tbody")?.textContent,
    ).toContain("Unknown");
    await act(async () =>
      root.render(<Harness economy={economy} preferred="GER" />),
    );
    expect(values("aluminium")[1]).toBe("0");
    expect(values("steel")[1]).toBe("—");
  });

  test("preserves fractional Rubber in tooltips and exact detail without mutating input", async () => {
    const economy = parseEconomy(economyFixture());
    const original = JSON.stringify(economy);
    await render(economy);
    expect(values("rubber")).toEqual([
      "128",
      "5.58",
      "19.2",
      "—",
      "105",
      "9.58",
    ]);
    expect(
      row("rubber").querySelectorAll("td")[1].querySelector("span")?.title,
    ).toBe("Raw saved value: 5.57792");
    await expand("rubber");
    expect(container.querySelector(".economy-facts")?.textContent).toContain(
      "5.57792",
    );
    expect(container.querySelector(".economy-facts")?.textContent).toContain(
      "9.57792",
    );
    expect(JSON.stringify(economy)).toBe(original);
    expect(
      row("rubber").querySelector("button")?.getAttribute("aria-expanded"),
    ).toBe("true");
    await expand("rubber");
    expect(container.querySelector(".economy-resource-detail")).toBeNull();
  });

  test("sea trade keeps raw delivery, separate efficiencies and convoy subscriber", async () => {
    await render();
    await expand("rubber");
    const cells = [
      ...container.querySelectorAll(".economy-trades tbody td"),
    ].map((cell) => cell.textContent);
    expect(cells).toEqual([
      "IndonesiaINS",
      "Import",
      "5.57792",
      "1 / 1",
      "Sea",
      "100%Convoy-loss efficiency: 69.72%",
      "9 / 9",
    ]);
    expect(container.querySelector(".economy-trades")?.textContent).toContain(
      "may temporarily differ",
    );
  });

  test("land trade has 6/6 CIV and absent convoy data, separately from resource rights", async () => {
    await render();
    await expand("tungsten");
    const trade = container.querySelector(".economy-trades tbody tr")!;
    const cells = [...trade.querySelectorAll("td")].map(
      (cell) => cell.textContent,
    );
    expect(cells.slice(1)).toEqual([
      "Import",
      "48",
      "6 / 6",
      "Land",
      "100%Convoy-loss efficiency: 100%",
      "—",
    ]);
    expect(trade.textContent).toContain("Portugal");
    expect(
      container.querySelector(".economy-rights tbody")?.textContent,
    ).toContain("Sweden");
    expect(
      container.querySelector(".economy-rights tbody")?.textContent,
    ).toContain("State 918");
    expect(
      container.querySelector(".economy-rights tbody")?.textContent,
    ).toContain("39.2");
    // Rights are not added to Extracted=12 or Imported=48.
    expect(values("tungsten").slice(0, 2)).toEqual(["12", "48"]);
    expect(container.querySelector(".economy-rights")?.textContent).toContain(
      "not an additional contribution",
    );
  });

  test("RKB delivery 32 remains different from national Imported 24; export allocation is 178", async () => {
    await render(parseEconomy(economyFixture("C")));
    expect(values("steel")).toEqual(["1,184", "24", "178", "28", "773", "229"]);
    await expand("steel");
    expect(
      container.querySelector(".economy-trades tbody")?.textContent,
    ).toContain("32");
    expect(
      container.querySelector(".economy-trades tbody td:nth-child(4)")
        ?.textContent,
    ).toBe("1 / 1");
    expect(
      container.querySelector(".economy-trades tbody td:last-child")
        ?.textContent,
    ).toBe("—");
    expect(
      container.querySelector(".economy-additional")?.textContent,
    ).toContain("Saved exported summary160");
  });

  test("initialized B preserves absent Steel import and positive balance", async () => {
    await render(parseEconomy(economyFixture("B")));
    expect(values("steel")).toEqual(["1,184", "—", "178", "28", "773", "205"]);
    expect(values("tungsten")[0]).toBe("118");
    expect(
      row("steel").lastElementChild?.classList.contains("economy-negative"),
    ).toBe(false);
  });

  test("legacy and empty collections display an unavailable/empty state, not fake zero rows", async () => {
    await act(async () => root.render(<Harness />));
    expect(container.textContent).toContain("Economy data unavailable");
    expect(container.querySelector("table")).toBeNull();
    await render({
      stateBasis: "serialized",
      countrySummaries: [],
      commercialTrades: [],
      resourceRightsOrigins: [],
    });
    expect(container.textContent).toContain("No national resource summaries");
    expect(container.querySelector("table")).toBeNull();
  });

  test("prefers reliable player country, preserves an explicit change, and supports outgoing trades", async () => {
    const economy = parseEconomy(economyFixture());
    economy.countrySummaries.reverse();
    await render(economy);
    const select = container.querySelector("select")!;
    expect(select.value).toBe("GER");
    await act(async () => {
      select.value = "POR";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await render(economy);
    expect(select.value).toBe("POR");
    await expand("tungsten");
    expect(
      container.querySelector(".economy-trades tbody")?.textContent,
    ).toContain("GermanyGERExport48");
  });

  test("unknown player has a safe country fallback", async () => {
    await act(async () =>
      root.render(
        <Harness economy={parseEconomy(economyFixture())} preferred="ZZZ" />,
      ),
    );
    expect(container.querySelector("select")?.value).toBe("GER");
  });

  test("Russian labels include detail, routes and caveats while exact raw decimals remain inspectable", async () => {
    await i18n.changeLanguage("ru");
    await render();
    expect(container.textContent).toContain("Алюминий");
    expect(container.textContent).toContain("Уголь");
    expect(container.textContent).toContain("После следующего пересчёта");
    expect(values("rubber")[1]).toBe("5,58");
    await expand("rubber");
    expect(container.textContent).toContain("Коммерческая торговля");
    expect(container.textContent).toContain("Права на ресурсы");
    expect(container.textContent).toContain("Морской");
    expect(container.textContent).toContain("5.57792");
    expect(container.textContent).not.toMatch(
      /Commercial trade|Resource rights|Convoy-loss|economy\./,
    );
  });

  test("Analyzer navigation opens Economy and can return to existing views, including legacy results", async () => {
    const result: AnalyzeResult = {
      game_date: "1944.5.1.2",
      parse_seconds: 0,
      file_size_mb: 1,
      active_countries: 0,
      totals: {
        divisions: 0,
        ships: 0,
        aircraft: 0,
        manpowerInField: 0,
        effectiveMilitaryFactories: 0,
        effectiveCivilianFactories: 0,
        effectiveDockyards: 0,
      },
      by_country: [],
      equipment_by_country: {},
      world_equipment: {},
      stockpileSummaries: [],
      militaryProductionSummaries: [],
      divisionSummaries: [],
      divisionTemplateCatalog: [],
      divisionEquipmentCatalog: [],
      armyHierarchySummaries: [],
      navalLosses: [],
      navalLossSummaries: [],
      navalKills: [],
      navalKillSummaries: [],
      navalKillerShipSummaries: [],
      economy: parseEconomy(economyFixture()),
    };
    await act(async () => root.render(<AnalyzerTab readOnlyResult={result} />));
    const tab = (label: string) =>
      [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (button) => button.textContent === label,
      )!;
    await act(async () => tab("Economy & Trade").click());
    expect(tab("Economy & Trade").getAttribute("aria-selected")).toBe("true");
    expect(values("steel")[5]).toBe("-64");
    await act(async () => {
      const select = container.querySelector(
        ".economy-head select",
      )! as HTMLSelectElement;
      select.value = "POR";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => tab("Production").click());
    await act(async () => tab("Economy & Trade").click());
    expect(
      container.querySelector<HTMLSelectElement>(".economy-head select")?.value,
    ).toBe("POR");
    await act(async () => tab("Overview").click());
    expect(container.textContent).toContain("Strategic overview");
    await act(async () =>
      root.render(
        <AnalyzerTab
          key="legacy"
          readOnlyResult={{ ...result, economy: undefined }}
        />,
      ),
    );
    await act(async () => tab("Economy & Trade").click());
    expect(container.textContent).toContain("Economy data unavailable");
  });

  test("number formatting is presentation-only and deterministic", () => {
    expect(formatEconomyNumber(0, "en-US")).toBe("0");
    expect(formatEconomyNumber(null, "en-US")).toBe("—");
    expect(formatEconomyNumber(5.57792, "en-US")).toBe("5.58");
    expect(rawEconomyValue(5.57792)).toBe("5.57792");
    expect(formatEconomyNumber(NaN, "en-US")).toBe("—");
  });

  // Opt-in, read-only real controls; never redistribute saves or depend on user folders in CI.
  for (const [state, filename, expected] of [
    [
      "A",
      "autosave_100_reload_1192_control_temp.hoi4",
      ["897", "—", "160", "28", "773", "-64"],
    ],
    [
      "B",
      "post_load_1h_no_trade_control_temp.hoi4",
      ["1,184", "—", "178", "28", "773", "205"],
    ],
    [
      "C",
      "subject_trade_control_temp.hoi4",
      ["1,184", "24", "178", "28", "773", "229"],
    ],
  ] as const) {
    const path = resolve(process.cwd(), "../saves", filename);
    test.skipIf(
      process.env.HOI4_ECONOMY_REAL_SAVES !== "1" || !existsSync(path),
    )(
      `read-only real ${state}: frontend renders serialized control`,
      async () => {
        const economy = parseEconomy(readFileSync(path, "utf8"));
        await render(economy);
        expect(values("steel")).toEqual(expected);
        await expand("steel");
        if (state === "C")
          expect(
            container.querySelector(".economy-trades tbody")?.textContent,
          ).toContain("32");
        expect(
          economy.resourceRightsOrigins.find(
            (origin) => origin.giverTag === "SWE",
          )?.resources.tungsten,
        ).toBe(39.2);
      },
      30000,
    );
  }
});
