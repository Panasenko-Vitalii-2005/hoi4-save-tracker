import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CampaignTrends } from "@/components/chart/CampaignTrends";
import type {
  CampaignEquipmentTrendsDto,
  CampaignTrendSnapshot,
  CampaignTrendsDto,
} from "@/types/campaign-trends";
import type { SaveRecord } from "@/types";

vi.mock("react-plotly.js", () => ({
  default: ({
    data,
    layout,
  }: {
    data: unknown[];
    layout: Record<string, unknown>;
  }) => (
    <div
      data-testid="trend-plot"
      data-traces={JSON.stringify(data)}
      data-layout={JSON.stringify(layout)}
    />
  ),
}));

const campaignId = "0731c3c7-035e-46b1-b07b-6c35b27e8dc2";
const metrics = (value: number) => ({
  activeCountries: 80 + value,
  divisions: value,
  manpowerInField: value * 1000,
  aircraft: value * 10,
  ships: value * 2,
  militaryFactories: value * 3,
  civilianFactories: value * 4,
  dockyards: value,
});
const snapshot = (
  key: string,
  gameDate: string,
  value: number,
  countries = [
    {
      tag: "GER",
      metrics: {
        divisions: value,
        manpowerInField: value * 1000,
        aircraft: value * 10,
        ships: value,
        militaryFactories: value * 3,
        civilianFactories: value * 4,
        dockyards: value,
        calculatedCasualties: value * 100,
      },
    },
  ],
): CampaignTrendSnapshot => ({
  hash: key.repeat(64),
  fileName: `${key}.hoi4`,
  gameDate,
  analyzedAt: `2026-01-0${value}T00:00:00.000Z`,
  gameVersion: "1.19.2",
  metrics: metrics(value),
  countries,
});
const dto = (
  snapshots: CampaignTrendSnapshot[] = [
    snapshot("a", "1936.6.1", 1),
    snapshot("b", "1936.8.1", 2),
    snapshot("c", "1936.11.1", 3),
  ],
): CampaignTrendsDto => ({
  snapshotCount: snapshots.length,
  campaigns: [
    {
      key: `campaign:${campaignId}`,
      campaignId,
      playerCountryTag: "GER",
      relationship: "known",
      snapshotCount: snapshots.length,
      firstGameDate: snapshots[0]?.gameDate ?? null,
      latestGameDate: snapshots.at(-1)?.gameDate ?? null,
      gameVersions: ["1.19.2"],
      snapshots,
    },
  ],
});

const equipmentDto = (
  campaign = dto().campaigns[0],
): CampaignEquipmentTrendsDto => ({
  campaignKey: campaign.key,
  countryTag: "GER",
  snapshotHashes: campaign.snapshots.map(({ hash }) => hash),
  definitions: [
    {
      equipmentDefinition: "infantry_equipment_1",
      stockpileBalance: [-1.25, null, 0],
      activeFactories: [0, 4, null],
      currentItemsPerDay: [1.5, null, null],
      productionRateComplete: [true, false, null],
    },
    {
      equipmentDefinition: "modded__tank",
      stockpileBalance: [null, 2.5, 3],
      activeFactories: [null, null, null],
      currentItemsPerDay: [null, null, null],
      productionRateComplete: [null, null, null],
    },
    {
      equipmentDefinition: "modded_tank",
      stockpileBalance: [1, 2, 3],
      activeFactories: [null, null, null],
      currentItemsPerDay: [null, null, null],
      productionRateComplete: [null, null, null],
    },
  ],
});

const telemetry: SaveRecord = {
  real_time: "2026-01-01T00:00:00Z",
  game_date: "1936.6.1",
  file_size_bytes: 100,
  file_size_mb: 1,
  write_duration_seconds: 2,
  write_speed_mb_per_sec: 50,
  cpu_avg: 10,
  cpu_max: 20,
  ram_avg: 512,
  ram_max: 600,
  resource_samples: 1,
  divisions: 1,
  army_groups: 1,
  ships: 1,
  planes: 1,
  active_countries: 1,
  parse_seconds: 1,
  interval_seconds: 1,
  interval_human: "1 second",
  game_days_passed: 1,
  seconds_per_game_day: 1,
};

describe("Campaign Trends", () => {
  let container: HTMLDivElement;
  let root: Root;
  let response: CampaignTrendsDto;
  let equipmentResponse: CampaignEquipmentTrendsDto;
  let fail = false;

  beforeEach(() => {
    localStorage.clear();
    response = dto();
    equipmentResponse = equipmentDto(response.campaigns[0]);
    fail = false;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        fail
          ? Promise.reject(new Error("private path"))
          : Promise.resolve(
              Response.json(
                String(input).includes("/trends/equipment")
                  ? equipmentResponse
                  : response,
              ),
            ),
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
  });

  const render = async (
    records: SaveRecord[] = [],
    actions: {
      onAnalyzeSave?: () => void;
      onImportCampaign?: () => void;
    } = {},
  ) => {
    await act(async () =>
      root.render(
        <CampaignTrends
          telemetry={records}
          telemetryLoading={false}
          telemetryError={null}
          reloadTelemetry={() => undefined}
          {...actions}
        />,
      ),
    );
  };
  const text = () => container.textContent ?? "";
  const select = (label: string) =>
    [...container.querySelectorAll("label")]
      .find((node) => node.textContent?.includes(label))
      ?.querySelector("select") as HTMLSelectElement;
  const checkbox = (label: string) =>
    [...container.querySelectorAll("label")]
      .find((node) => node.textContent?.includes(label))
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement;
  const choose = async (control: HTMLSelectElement, value: string) => {
    await act(async () => {
      control.value = value;
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  const toggle = async (control: HTMLInputElement) => {
    await act(async () => control.click());
  };
  const traces = () =>
    JSON.parse(
      container
        .querySelector('[data-testid="trend-plot"]')
        ?.getAttribute("data-traces") ?? "[]",
    ) as {
      name: string;
      x: unknown[];
      y: (number | null)[];
      customdata: unknown[][];
      hovertemplate: string;
    }[];
  const layout = () =>
    JSON.parse(
      container
        .querySelector('[data-testid="trend-plot"]')
        ?.getAttribute("data-layout") ?? "{}",
    ) as { xaxis?: Record<string, unknown> };

  test("renders heading, campaign summary, timeline, and an accessible multi-save chart", async () => {
    await render();
    expect(text()).toContain("Campaign Trends");
    expect(text()).toContain("Germany");
    expect(text()).not.toContain(
      "Campaign Trends needs multiple analyzed saves",
    );
    expect(text()).toContain("1936.6.1 → 1936.11.1");
    expect(traces()).toHaveLength(4);
    expect(
      container.querySelector('[role="img"]')?.getAttribute("aria-label"),
    ).toContain("3 campaign snapshots");
    expect(
      container.querySelectorAll(".campaign-timeline tbody tr"),
    ).toHaveLength(3);
    expect(
      container.querySelectorAll(
        '[aria-label="Export selected campaign trends"] button',
      ),
    ).toHaveLength(2);
    const reportButton = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "View Report",
    )!;
    await act(async () => reportButton.click());
    expect(container.textContent).toContain("Germany Campaign");
    expect(container.textContent).toContain("Campaign Chart");
  });

  test("renders meaningful empty and single-save states without empty Plotly axes", async () => {
    response = { snapshotCount: 0, campaigns: [] };
    const analyze = vi.fn();
    const importCampaign = vi.fn();
    await render([], {
      onAnalyzeSave: analyze,
      onImportCampaign: importCampaign,
    });
    expect(text()).toContain("No campaign trend data yet");
    expect(text()).toContain(
      "Campaign Trends needs multiple analyzed saves from the same campaign",
    );
    expect(container.querySelector('[data-testid="trend-plot"]')).toBeNull();
    expect(
      container.querySelector('[aria-label="Export selected campaign trends"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("View Report");
    const importButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Import Campaign",
    )!;
    await act(async () => importButton.click());
    expect(importCampaign).toHaveBeenCalledTimes(1);
    const analyzeButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Analyze Save",
    )!;
    await act(async () => analyzeButton.click());
    expect(analyze).toHaveBeenCalledTimes(1);

    response = dto([snapshot("a", "1936.6.1", 1)]);
    const refresh = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Refresh"),
    )!;
    await act(async () => refresh.click());
    expect(text()).toContain("One campaign snapshot available");
    expect(container.querySelector('[data-testid="trend-plot"]')).toBeNull();
  });

  test("keeps known campaigns separated and exposes a selector only when needed", async () => {
    response = dto();
    response.snapshotCount += 1;
    response.campaigns.push({
      ...dto([snapshot("d", "1948.4.1", 4)]).campaigns[0],
      key: "campaign:different",
      campaignId: "016a6f0b-47b4-4812-a626-73537dcc5c56",
    });
    await render();
    expect(select("Campaign").options).toHaveLength(2);
    expect(select("Campaign").options[0].text).toBe(
      "Germany · 1936.6.1 → 1936.11.1 · 3 saves",
    );
    await choose(select("Campaign"), "campaign:different");
    expect(text()).toContain("1948.4.1 → 1948.4.1");
    expect(text()).toContain("One campaign snapshot available");
  });

  test("uses safe known and legacy labels when player metadata is unavailable", async () => {
    const known = dto().campaigns[0];
    const legacySnapshot = snapshot("z", "1935.1.1", 1);
    response = {
      snapshotCount: 4,
      campaigns: [
        { ...known, playerCountryTag: null },
        {
          ...dto([legacySnapshot]).campaigns[0],
          key: `unknown:${legacySnapshot.hash}`,
          campaignId: null,
          playerCountryTag: null,
          relationship: "unknown",
        },
      ],
    };

    await render();

    expect(select("Campaign").options[0].text).toContain("Known campaign");
    expect(select("Campaign").options[0].text).not.toContain(campaignId);
    expect(select("Campaign").options[1].text).toContain("Legacy campaign");
    expect(select("Campaign").options[1].text).not.toContain("z.hoi4");
  });

  test("falls back to an exact dynamic country tag when no display name exists", async () => {
    response = dto();
    response.campaigns[0].playerCountryTag = "D01";

    await render();

    expect(text()).toContain("D01");
  });

  test("defaults country trends to the known player country and preserves an explicit selection", async () => {
    const countries = (value: number) => [
      {
        tag: "AFG",
        metrics: {
          divisions: value,
          manpowerInField: value,
          aircraft: value,
          ships: value,
          militaryFactories: value,
          civilianFactories: value,
          dockyards: value,
          calculatedCasualties: value,
        },
      },
      snapshot("x", "1936.1.1", value).countries[0],
    ];
    response = dto([
      snapshot("a", "1936.6.1", 1, countries(1)),
      snapshot("b", "1936.8.1", 2, countries(2)),
    ]);

    await render();
    const countryButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Country",
    )!;
    await act(async () => countryButton.click());
    expect(select("Country").value).toBe("GER");

    await choose(select("Country"), "AFG");
    expect(select("Country").value).toBe("AFG");
    const refresh = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Refresh"),
    )!;
    await act(async () => refresh.click());
    expect(select("Country").value).toBe("AFG");
  });

  test.each([null, "ZZZ"])(
    "uses the safe first-country fallback when player country %s is unavailable",
    async (playerCountryTag) => {
      const germany = snapshot("x", "1936.1.1", 1).countries[0];
      response = dto([
        snapshot("a", "1936.6.1", 1, [
          {
            ...germany,
            tag: "AFG",
          },
          germany,
        ]),
      ]);
      response.campaigns[0].playerCountryTag = playerCountryTag;

      await render();
      const countryButton = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Country",
      )!;
      await act(async () => countryButton.click());
      expect(select("Country").value).toBe("AFG");
    },
  );

  test("supports presets and compact multi-select metrics", async () => {
    await render();
    await choose(select("Preset"), "Industry Growth");
    expect(traces().map(({ name }) => name)).toEqual([
      "Military factories",
      "Civilian factories",
      "Dockyards",
    ]);
    await toggle(checkbox("Dockyards"));
    expect(traces().map(({ name }) => name)).toEqual([
      "Military factories",
      "Civilian factories",
    ]);
  });

  test("renders equipment controls and preserves signed, fractional, zero, and sparse stockpile values", async () => {
    await render();
    const equipmentButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Equipment",
    )!;
    await act(async () => equipmentButton.click());

    expect(equipmentButton.getAttribute("aria-pressed")).toBe("true");
    expect(select("Country").value).toBe("GER");
    expect(select("Exact equipment definition").value).toBe(
      "infantry_equipment_1",
    );
    expect(select("Equipment metric").value).toBe("stockpileBalance");
    expect(traces()).toHaveLength(1);
    expect(traces()[0].y).toEqual([-1.25, null, 0]);
    expect(text()).toContain("Missing definitions");
    expect(text()).toContain("normalization is unavailable");
    expect(checkbox("Normalize")).toBeUndefined();
    await choose(select("Moving average"), "3");
    expect(traces()[0].y).toEqual([-1.25, null, 0]);
  });

  test("keeps incomplete production rate as a labelled gap and supports active zero", async () => {
    await render();
    const equipmentButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Equipment",
    )!;
    await act(async () => equipmentButton.click());
    await choose(select("Equipment metric"), "currentItemsPerDay");
    expect(traces()[0].y).toEqual([1.5, null, null]);
    expect(traces()[0].customdata[1]).toContain("Incomplete rate");
    expect(text()).toContain("1 production-rate snapshot is incomplete");

    await choose(select("Equipment metric"), "activeFactories");
    expect(traces()[0].y).toEqual([0, 4, null]);
  });

  test("keeps unknown definitions selectable and same readable labels distinct by exact identity", async () => {
    await render();
    const equipmentButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Equipment",
    )!;
    await act(async () => equipmentButton.click());
    const definitions = select("Exact equipment definition");
    expect([...definitions.options].map(({ value }) => value)).toEqual([
      "infantry_equipment_1",
      "modded__tank",
      "modded_tank",
    ]);
    expect(definitions.options[1].text).toContain("modded__tank");
    expect(definitions.options[2].text).toContain("modded_tank");
    await choose(definitions, "modded__tank");
    expect(traces()[0].y).toEqual([null, 2.5, 3]);
  });

  test("shows a safe equipment state when no campaign country is available", async () => {
    response = dto([
      snapshot("a", "1936.6.1", 1, []),
      snapshot("b", "1936.8.1", 2, []),
    ]);
    await render();
    const equipmentButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Equipment",
    )!;
    await act(async () => equipmentButton.click());
    expect(text()).toContain("No country available");
    expect(text()).toContain("No country snapshot data is available");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  test("switching back from equipment restores unchanged global presets", async () => {
    await render();
    const equipmentButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Equipment",
    )!;
    await act(async () => equipmentButton.click());
    const globalButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Global",
    )!;
    await act(async () => globalButton.click());
    expect(globalButton.getAttribute("aria-pressed")).toBe("true");
    expect(select("Preset").value).toBe("Military Growth");
    expect(traces()).toHaveLength(4);
    expect(traces()[0].name).toBe("Divisions");
  });

  test("normalizes displayed values while retaining original snapshot values", async () => {
    await render();
    expect(checkbox("Normalize").checked).toBe(true);
    expect(traces()[0].y).toEqual([0, 0.5, 1]);
    expect(text()).toContain("Tooltips retain original values");
    await toggle(checkbox("Normalize"));
    expect(traces()[0].y).toEqual([1, 2, 3]);
  });

  test("moving average is discrete and does not bridge missing values", async () => {
    const missing = snapshot("b", "1936.8.1", 2);
    missing.metrics.divisions = null;
    response = dto([
      snapshot("a", "1936.6.1", 1),
      missing,
      snapshot("c", "1936.11.1", 3),
    ]);
    localStorage.setItem(
      "hoi4-campaign-trends-v1",
      JSON.stringify({ metrics: ["divisions"] }),
    );
    await render();
    await choose(select("Moving average"), "3");
    expect(traces()[0].y).toEqual([0, null, 1]);
    expect(text()).toContain("does not bridge unavailable values");
  });

  test("supports save-sequence X axis and preserves duplicate dates by default", async () => {
    response = dto([
      snapshot("a", "1936.6.1", 1),
      snapshot("b", "1936.6.1", 2),
      snapshot("c", "1936.11.1", 3),
    ]);
    await render();
    expect(traces()[0].x).toEqual(["1936-06-01", "1936-06-01", "1936-11-01"]);
    expect(layout().xaxis?.type).toBe("date");
    await choose(select("X-axis"), "sequence");
    expect(traces()[0].x).toEqual([1, 2, 3]);
    expect(layout().xaxis?.type).toBe("linear");
    await toggle(checkbox("One snapshot per game date"));
    expect(
      container.querySelectorAll(".campaign-timeline tbody tr"),
    ).toHaveLength(2);
  });

  test("uses a sparse automatic date axis without removing large-campaign points", async () => {
    const largeCampaign = Array.from({ length: 179 }, (_, index) => {
      const year = 1936 + Math.floor(index / 12);
      const month = (index % 12) + 1;
      return snapshot(
        String.fromCharCode(97 + (index % 26)),
        `${year}.${month}.1`,
        index + 1,
      );
    }).map((entry, index) => ({
      ...entry,
      hash: index.toString(16).padStart(64, "0"),
      fileName: `autosave_${index + 1}.hoi4`,
      analyzedAt: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    }));
    response = dto(largeCampaign);

    await render();

    expect(traces()[0].x).toHaveLength(179);
    expect(text()).toContain("Germany");
    expect(text()).toContain("179 saves");
    expect(traces()[0].x[0]).toBe("1936-01-01");
    expect(traces()[0].x.at(-1)).toBe("1950-11-01");
    expect(traces()[0].customdata[0][2]).toBe("1936.1.1");
    expect(traces()[0].hovertemplate).toContain("Date: %{customdata[2]}");
    expect(layout().xaxis).toMatchObject({
      type: "date",
      tickmode: "auto",
      nticks: 8,
      tickangle: 0,
    });
    expect(layout().xaxis).not.toHaveProperty("tickvals");
    expect(layout().xaxis).not.toHaveProperty("ticktext");
  });

  test("keeps small campaigns on the same readable date axis", async () => {
    await render();
    expect(traces()[0].x).toEqual(["1936-06-01", "1936-08-01", "1936-11-01"]);
    expect(layout().xaxis).toMatchObject({ type: "date", tickmode: "auto" });
    expect(traces()[0].customdata.map((data) => data[2])).toEqual([
      "1936.6.1",
      "1936.8.1",
      "1936.11.1",
    ]);
  });

  test("country focus uses exact tags and renders country absence as a gap", async () => {
    response = dto([
      snapshot("a", "1936.6.1", 1),
      snapshot("b", "1936.8.1", 2, []),
      snapshot("c", "1936.11.1", 3),
    ]);
    await render();
    const countryButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Country",
    )!;
    await act(async () => countryButton.click());
    expect(countryButton.getAttribute("aria-pressed")).toBe("true");
    expect(select("Country").value).toBe("GER");
    expect(traces()[0].y).toEqual([0, null, 1]);
    expect(text()).toContain(
      "Missing country snapshots remain gaps, not zeroes",
    );
  });

  test("timeline rows support mouse, Enter, Space, and expose selected state", async () => {
    await render();
    const rows = [
      ...container.querySelectorAll<HTMLTableRowElement>(
        ".campaign-timeline tbody tr",
      ),
    ];
    expect(rows[2].getAttribute("aria-selected")).toBe("true");
    await act(async () =>
      rows[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(rows[0].getAttribute("aria-selected")).toBe("true");
    await act(async () =>
      rows[1].dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true }),
      ),
    );
    expect(rows[1].getAttribute("aria-selected")).toBe("true");
    await act(async () => rows[2].click());
    expect(rows[2].getAttribute("aria-selected")).toBe("true");
  });

  test("keeps real tracker telemetry separate and hidden when unavailable", async () => {
    await render([telemetry]);
    expect(text()).toContain("Autosave Performance");
    expect(text()).toContain("It is not joined to analyzed campaign snapshots");
    expect(
      container.querySelector(".campaign-telemetry")?.hasAttribute("open"),
    ).toBe(false);
  });

  test("recoverable refresh errors retain the previous campaign and hide private details", async () => {
    await render();
    fail = true;
    const refresh = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Refresh"),
    )!;
    await act(async () => refresh.click());
    expect(
      container.querySelector('[data-testid="trend-plot"]'),
    ).not.toBeNull();
    expect(text()).toContain("temporarily unavailable");
    expect(text()).not.toContain("private path");
  });

  test("initial load failure is distinct from empty data and recovers explicitly", async () => {
    fail = true;
    await render();

    expect(text()).toContain("Campaign trends unavailable");
    expect(text()).toContain("Cannot reach the analyzer service");
    expect(text()).not.toContain("No campaign trend data yet");
    expect(container.querySelector('[data-testid="trend-plot"]')).toBeNull();

    fail = false;
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Try again",
    )!;
    await act(async () => retry.click());
    expect(
      container.querySelector('[data-testid="trend-plot"]'),
    ).not.toBeNull();
  });
});
