import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CampaignTrends } from "../src/components/chart/CampaignTrends";
import { AnalysisComparisonResults } from "../src/components/analyzer/AnalysisComparisonResults";
import { i18n } from "../src/i18n";
import {
  ECONOMY_TREND_METRICS,
  economyTrendValue,
} from "../src/lib/economy-metrics";
import {
  ECONOMY_LEDGER_METRICS,
  type EconomyLedger,
} from "../src/types/economy";
import type {
  CampaignTrendsDto,
  CampaignTrendSnapshot,
} from "../src/types/campaign-trends";
import type {
  AnalysisComparisonDto,
  NumericDiff,
  CountryComparison,
} from "../src/types/analysis-comparison";
import { campaignCsv, comparisonCsv } from "../src/lib/data-export";
// Test-only reuse of accepted Phase 2A fixtures and the actual compact projection.
import { parseEconomy } from "../../server/src/hoi4/economy/economy.parser";
import { economyFixture } from "../../server/src/hoi4/economy/fixtures/economy.fixture";
import { projectEconomyLedgers } from "../../server/src/analyze/economy-ledger-projection";
import { comparisonResult } from "../../server/src/analyze/fixtures/analysis-comparison.fixture";

vi.mock("react-plotly.js", () => ({
  default: ({ data }: { data: unknown }) => (
    <div data-testid="plot" data-traces={JSON.stringify(data)} />
  ),
}));
const ledger = (state: "A" | "B" | "C"): EconomyLedger =>
  projectEconomyLedgers(
    comparisonResult({ economy: parseEconomy(economyFixture(state)) }),
  ).get("GER")!;
const diff = (before: number | null, after: number | null): NumericDiff => ({
  before,
  after,
  delta: before === null || after === null ? null : after - before,
});
const metrics = {
  divisions: 10,
  manpowerInField: 1000,
  aircraft: 5,
  ships: 2,
  militaryFactories: 4,
  civilianFactories: 5,
  dockyards: 3,
  calculatedCasualties: null,
};
const snapshot = (state: "A" | "B" | "C"): CampaignTrendSnapshot => ({
  hash: state.toLowerCase().repeat(64),
  fileName: `${state}.hoi4`,
  gameDate: "1944.5.1",
  analyzedAt: `2026-10-04T10:0${state === "A" ? 0 : state === "B" ? 1 : 2}:00Z`,
  gameVersion: "1.19.2",
  metrics: { ...metrics, activeCountries: 1 },
  countries: [{ tag: "GER", metrics, economy: ledger(state) }],
});
const dto = (): CampaignTrendsDto => ({
  snapshotCount: 3,
  campaigns: [
    {
      key: "campaign:fixture",
      campaignId: "fixture",
      playerCountryTag: "GER",
      relationship: "known",
      snapshotCount: 3,
      firstGameDate: "1944.5.1",
      latestGameDate: "1944.5.1",
      gameVersions: ["1.19.2"],
      snapshots: [snapshot("A"), snapshot("B"), snapshot("C")],
    },
  ],
});
function comparison(
  a: "A" | "B" | "C",
  b: "A" | "B" | "C",
): AnalysisComparisonDto {
  const left = ledger(a),
    right = ledger(b);
  const country: CountryComparison = {
    tag: "GER",
    status: "unchanged",
    hasChanges: true,
    effectiveMilitaryFactories: diff(4, 4),
    effectiveCivilianFactories: diff(5, 5),
    effectiveDockyards: diff(3, 3),
    divisions: diff(10, 10),
    manpowerInField: diff(1000, 1000),
    ships: diff(2, 2),
    calculatedWarCasualtiesTotal: diff(null, null),
  };
  return {
    baseHash: a.toLowerCase().repeat(64),
    targetHash: b.toLowerCase().repeat(64),
    baseGameDate: "1944.5.1",
    targetGameDate: "1944.5.1",
    context: {
      sameAnalysis: a === b,
      chronology: "same_date",
      campaignCompatibility: "same",
      gameVersionCompatibility: "same",
    },
    hasChanges: a !== b,
    summary: {
      activeCountries: diff(1, 1),
      divisions: diff(10, 10),
      manpowerInField: diff(1000, 1000),
      aircraft: diff(5, 5),
      ships: diff(2, 2),
      navalLossCount: diff(0, 0),
    },
    countries: [country],
    equipmentProduction: [],
    economy: [
      {
        countryTag: "GER",
        hasChanges: a !== b,
        resources: Object.keys(left).map((key) => {
          const resource = key as keyof EconomyLedger;
          return {
            resource,
            ...Object.fromEntries(
              ECONOMY_LEDGER_METRICS.map((metric) => [
                metric,
                diff(left[resource][metric], right[resource][metric]),
              ]),
            ),
          };
        }) as NonNullable<
          AnalysisComparisonDto["economy"]
        >[number]["resources"],
      },
    ],
  };
}

describe("Economy Compare and Campaign Trends presentation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let response: CampaignTrendsDto;
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    localStorage.clear();
    response = dto();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(response), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
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
  const renderCompare = async (data = comparison("A", "B")) => {
    await act(async () =>
      root.render(
        <AnalysisComparisonResults
          data={data}
          baseName="A.hoi4"
          targetName="B.hoi4"
          onViewReport={() => {}}
        />,
      ),
    );
  };
  const renderTrends = async (
    keys: string[] = ["economy.steel.serializedBalance"],
    settings = {},
  ) => {
    localStorage.setItem(
      "hoi4-campaign-trends-v1",
      JSON.stringify({
        scope: "country",
        metrics: keys,
        normalize: false,
        ...settings,
      }),
    );
    await act(async () =>
      root.render(
        <CampaignTrends
          telemetry={[]}
          telemetryLoading={false}
          telemetryError={null}
          reloadTelemetry={() => {}}
        />,
      ),
    );
  };
  const traces = () =>
    JSON.parse(
      container
        .querySelector('[data-testid="plot"]')
        ?.getAttribute("data-traces") ?? "[]",
    ) as {
      name: string;
      y: (number | null)[];
      customdata: string[][];
      connectgaps: boolean;
      hovertemplate: string;
    }[];
  const economyPanel = () =>
    container.querySelector('section[aria-label="Economy & Trade"]')!;
  const resource = (name: string) =>
    [...economyPanel().querySelectorAll("details")].find((node) =>
      node.querySelector("summary")?.textContent?.startsWith(name),
    )!;
  const values = (name: string, metric: string) =>
    [...resource(name).querySelectorAll("tr")].find(
      (row) => row.querySelector("th")?.textContent === metric,
    )?.textContent;
  const choose = async (label: string, value: string) => {
    const select = [...container.querySelectorAll("label")]
      .find((node) => node.textContent?.includes(label))!
      .querySelector("select")!;
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

  test("Compare renders six resource details with Target−Base changes and nullable fields", async () => {
    await renderCompare();
    expect(economyPanel().querySelectorAll("details")).toHaveLength(6);
    expect(values("Steel", "Extracted")).toContain("8971,184+287");
    expect(values("Steel", "Balance")).toContain("-64205+269");
    expect(values("Steel", "Imported")).toContain("——N/A");
    expect(values("Steel", "Production")).toContain("773773—");
    expect(economyPanel().textContent).toContain(
      i18n.t("economy.serializedNote"),
    );
    expect(economyPanel().textContent).not.toMatch(
      /Oil|Fuel|Convoys|Resource rights/,
    );
  });
  test("Compare B -> C preserves Imported absent -> 24 and +24 balance, not delivered 32", async () => {
    await renderCompare(comparison("B", "C"));
    expect(values("Steel", "Imported")).toContain("—24N/A");
    expect(values("Steel", "Exported")).toContain("178178—");
    expect(values("Steel", "Balance")).toContain("205229+24");
    expect(values("Steel", "Imported")).not.toContain("32");
  });
  test("Compare distinguishes zero, reverse deltas and inspectable fractional raw values", async () => {
    const data = comparison("C", "B");
    data.economy![0].resources[1].imported = diff(5.57792, 0);
    await renderCompare(data);
    expect(values("Steel", "Balance")).toContain("229205-24");
    expect(values("Rubber", "Imported")).toContain(
      `5.580-${(5.57792).toLocaleString(undefined, { maximumFractionDigits: 15 })}`,
    );
    expect(
      resource("Rubber").querySelector('[title="5.57792"]'),
    ).not.toBeNull();
  });
  test("legacy Compare response stays usable without fabricated resource rows", async () => {
    const data = comparison("A", "B");
    delete data.economy;
    await renderCompare(data);
    expect(economyPanel().textContent).toContain("Economy data unavailable");
    expect(economyPanel().querySelector("table")).toBeNull();
    expect(container.textContent).toContain("Active countries");
  });
  test("Trends retains raw A/B/C balances, null imports and decimals", async () => {
    await renderTrends([
      "economy.steel.serializedBalance",
      "economy.steel.imported",
      "economy.rubber.imported",
      "economy.tungsten.extracted",
      "economy.tungsten.serializedBalance",
      "economy.steel.extracted",
    ]);
    expect(traces().map((trace) => trace.y)).toEqual([
      [-64, 205, 229],
      [null, null, 24],
      [5.57792, 5.57792, 5.57792],
      [12, 118, 118],
      [-95, 1, 1],
      [897, 1184, 1184],
    ]);
    expect(traces()[2].customdata[0][1]).toBe("5.57792");
    expect(traces().every(({ connectgaps }) => connectgaps === false)).toBe(
      true,
    );
    expect(container.textContent).toContain(i18n.t("economy.serializedNote"));
  });
  test("all 36 registry metrics extract only the serialized country ledger", () => {
    const source = snapshot("A");
    expect(ECONOMY_TREND_METRICS).toHaveLength(36);
    for (const definition of ECONOMY_TREND_METRICS) {
      expect(definition.global).toBe(false);
      expect(economyTrendValue(source, "GER", definition.key)).toBe(
        source.countries[0].economy![definition.resource][definition.metric],
      );
      expect(economyTrendValue(source, "XXX", definition.key)).toBeNull();
    }
  });
  test("legacy/missing resource/country snapshots remain gaps including normalization and moving average", async () => {
    response.campaigns[0].snapshots.splice(1, 0, {
      ...snapshot("B"),
      hash: "d".repeat(64),
      countries: [{ tag: "GER", metrics }],
    });
    await renderTrends();
    expect(traces()[0].y).toEqual([-64, null, 205, 229]);
    await choose("Moving average", "3");
    expect(traces()[0].y).toEqual([-64, null, 205, 217]);
    await act(async () =>
      [...container.querySelectorAll("label")]
        .find((node) => node.textContent === "Normalize")!
        .querySelector("input")!
        .click(),
    );
    expect(traces()[0].y[1]).toBeNull();
    expect(traces()[0].y[0]).toBe(0);
    expect(traces()[0].y[3]).toBe(1);
  });
  test("missing field and missing country do not become zero, while stored zero does", async () => {
    response.campaigns[0].snapshots[0].countries = [];
    response.campaigns[0].snapshots[1].countries[0].economy!.steel.serializedBalance =
      null;
    response.campaigns[0].snapshots[2].countries[0].economy!.steel.serializedBalance = 0;
    await renderTrends();
    expect(traces()[0].y).toEqual([null, null, 0]);
  });
  test("Economy preset switches to country scope; existing global default and selectors still work", async () => {
    await act(async () =>
      root.render(
        <CampaignTrends
          telemetry={[]}
          telemetryLoading={false}
          telemetryError={null}
          reloadTelemetry={() => {}}
        />,
      ),
    );
    expect(traces()[0].name).toBe("Divisions");
    expect(container.querySelector(".campaign-economy-metrics")).toBeNull();
    await choose("Preset", "Economy Overview");
    expect(traces()).toHaveLength(6);
    expect(traces().map(({ name }) => name)).toEqual(
      ["Aluminium", "Rubber", "Tungsten", "Steel", "Chromium", "Coal"].map(
        (name) => `${name} · Balance`,
      ),
    );
    expect(
      container.querySelectorAll(".campaign-economy-metrics input"),
    ).toHaveLength(36);
    await act(async () =>
      [...container.querySelectorAll(".campaign-economy-metrics label")]
        .find((node) => node.textContent === "Steel · Extracted")!
        .querySelector("input")!
        .click(),
    );
    expect(traces().at(-1)?.y).toEqual([897, 1184, 1184]);
    expect(
      JSON.parse(localStorage.getItem("hoi4-campaign-trends-v1")!).scope,
    ).toBe("country");
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((node) => node.textContent === "Global")!
        .click(),
    );
    expect(container.querySelector(".campaign-economy-metrics")).toBeNull();
    expect(traces()[0].name).toBe("Divisions");
  });
  test("Russian labels apply to Compare, metrics, preset, legend and hover without renaming identifiers", async () => {
    await i18n.changeLanguage("ru");
    await renderCompare();
    expect(container.textContent).toContain(i18n.t("economy.title"));
    expect(container.textContent).toContain(i18n.t("economy.resources.steel"));
    await renderTrends(["economy.steel.serializedBalance"], {
      preset: "Custom",
    });
    expect(traces()[0].name).toBe(
      `${i18n.t("economy.resources.steel")} · ${i18n.t("economy.balance")}`,
    );
    expect(container.textContent).toContain("Обзор экономики");
    expect(
      [...container.querySelectorAll("label")]
        .find((node) => node.textContent?.includes(i18n.t("campaign.preset")))!
        .querySelector("select")!.value,
    ).toBe("Custom");
    expect(traces()[0].hovertemplate).toContain("Сталь · Баланс");
    expect(traces()[0].hovertemplate).toContain("Дата:");
    expect(
      JSON.parse(localStorage.getItem("hoi4-campaign-trends-v1")!).metrics,
    ).toEqual(["economy.steel.serializedBalance"]);
  });
  test("existing CSV projections do not acquire Economy columns", () => {
    expect(
      campaignCsv(dto().campaigns[0], { scope: "country", countryTag: "GER" }),
    ).not.toMatch(/economy|serializedBalance|exportAllocation/);
    expect(
      comparisonCsv(comparison("B", "C"), { baseName: "B", targetName: "C" }),
    ).not.toMatch(/economy|serializedBalance|exportAllocation/);
  });
});
