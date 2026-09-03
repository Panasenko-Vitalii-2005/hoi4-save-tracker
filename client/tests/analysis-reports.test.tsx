import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SingleSaveReport } from "@/components/reports/SingleSaveReport";
import { ComparisonReport } from "@/components/reports/ComparisonReport";
import { CampaignReport } from "@/components/reports/CampaignReport";
import type { AnalyzeResult, CountryStats } from "@/types";
import type { AnalysisComparisonDto, NumericDiff } from "@/types/analysis-comparison";
import type { CampaignTrend } from "@/types/campaign-trends";

const country = (tag: string, manpowerInField: number): CountryStats =>
  ({
    tag,
    divisions: tag === "GER" ? 200 : 10,
    manpowerInField,
    aircraft: tag === "GER" ? 4000 : 100,
    ships: tag === "GER" ? 80 : 2,
    effectiveMilitaryFactories: tag === "GER" ? 286 : 10,
    effectiveCivilianFactories: tag === "GER" ? 228 : 8,
    effectiveDockyards: tag === "GER" ? 39 : 1,
    calculatedWarCasualtiesTotal: tag === "GER" ? 10_578_996 : 0,
    warCasualties: [],
  }) as unknown as CountryStats;

const saveResult = {
  game_date: "1944.5.1",
  file_size_mb: 104,
  parse_seconds: 3.2,
  active_countries: 96,
  totals: {
    divisions: 3250,
    manpowerInField: 31_378_714,
    aircraft: 53_095,
    ships: 1539,
    effectiveMilitaryFactories: 2456,
    effectiveCivilianFactories: 2069,
    effectiveDockyards: 628,
  },
  by_country: [
    country("GER", 2_000_000),
    ...Array.from({ length: 11 }, (_, index) =>
      country(`D${String(index).padStart(2, "0")}`, 1_900_000 - index),
    ),
  ],
  navalLosses: Array.from({ length: 993 }, () => ({})),
} as unknown as AnalyzeResult;

const diff = (before: number | null, after: number | null): NumericDiff => ({
  before,
  after,
  delta: before === null || after === null ? null : after - before,
});

const comparison: AnalysisComparisonDto = {
  baseHash: "a".repeat(64),
  targetHash: "b".repeat(64),
  baseGameDate: "1944.4.1",
  targetGameDate: "1944.5.1",
  context: {
    chronology: "target_after_base",
    sameAnalysis: false,
    campaignCompatibility: "different",
    gameVersionCompatibility: "different",
  },
  hasChanges: true,
  summary: {
    activeCountries: diff(95, 96),
    divisions: diff(3200, 3250),
    manpowerInField: diff(31_000_000, 31_378_714),
    aircraft: diff(54_000, 53_095),
    ships: diff(1540, 1539),
    navalLossCount: diff(990, 993),
  },
  countries: [
    {
      tag: "GER",
      status: "unchanged",
      hasChanges: true,
      effectiveMilitaryFactories: diff(280, 286),
      effectiveCivilianFactories: diff(227, 228),
      effectiveDockyards: diff(32, 39),
      divisions: diff(200, 200),
      manpowerInField: diff(1_975_560, 2_000_000),
      ships: diff(81, 80),
      calculatedWarCasualtiesTotal: diff(10_306_186, 10_578_996),
    },
    {
      tag: "D04",
      status: "added",
      hasChanges: true,
      effectiveMilitaryFactories: diff(null, 2),
      effectiveCivilianFactories: diff(null, 1),
      effectiveDockyards: diff(null, 0),
      divisions: diff(null, 1),
      manpowerInField: diff(null, 8000),
      ships: diff(null, 0),
      calculatedWarCasualtiesTotal: diff(null, 0),
    },
    {
      tag: "ENG",
      status: "removed",
      hasChanges: true,
      effectiveMilitaryFactories: diff(193, null),
      effectiveCivilianFactories: diff(162, null),
      effectiveDockyards: diff(56, null),
      divisions: diff(100, null),
      manpowerInField: diff(900_000, null),
      ships: diff(30, null),
      calculatedWarCasualtiesTotal: diff(1000, null),
    },
  ],
  equipmentProduction: [],
};

const campaign: CampaignTrend = {
  key: "campaign:test",
  campaignId: "0731c3c7-035e-46b1-b07b-6c35b27e8dc2",
  playerCountryTag: "GER",
  relationship: "known",
  snapshotCount: 3,
  firstGameDate: "1936.2.1",
  latestGameDate: "1936.4.1",
  gameVersions: ["1.19.2"],
  snapshots: [10, 20, 15].map((value, index) => ({
    hash: String(index).repeat(64),
    fileName: `autosave_${index}.hoi4`,
    gameDate: `1936.${index + 2}.1`,
    analyzedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
    gameVersion: "1.19.2",
    metrics: {
      activeCountries: 80,
      divisions: value,
      manpowerInField: value * 1000,
      aircraft: value * 10,
      ships: value,
      militaryFactories: value,
      civilianFactories: value + 5,
      dockyards: value / 5,
    },
    countries: [],
  })),
};

describe("analysis reports", () => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("renders a bounded single-save report with control values and metadata", async () => {
    await act(async () =>
      root.render(
        <SingleSaveReport
          result={saveResult}
          context={{
            fileName: "autosave_100_temp.hoi4",
            analysisHash: "a".repeat(64),
            playerCountryTag: "GER",
          }}
          onBack={() => undefined}
        />,
      ),
    );

    expect(container.textContent).toContain("Germany Save Report");
    expect(container.textContent).toContain("1 May 1944");
    expect(container.textContent).toContain("3,250");
    expect(container.textContent).toContain("53.1K");
    expect(container.textContent).toContain("286");
    expect(container.textContent).toContain("228");
    expect(container.textContent).toContain("39");
    expect(container.querySelectorAll(".report-table tbody tr")).toHaveLength(10);
    expect(container.querySelector('[aria-label="Export report data"]')).not.toBeNull();
  });

  test("keeps missing player metadata neutral and prints through the browser", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    await act(async () =>
      root.render(
        <SingleSaveReport
          result={saveResult}
          context={{ fileName: null, playerCountryTag: null }}
          onBack={() => undefined}
        />,
      ),
    );
    expect(container.textContent).toContain("Save Analysis Report");
    expect(container.textContent).toContain("Player country unavailable");
    expect(container.textContent).toContain("No country has been inferred");
    const printButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Print",
    )!;
    await act(async () => printButton.click());
    expect(print).toHaveBeenCalledOnce();
  });

  test("renders Compare Base, Target and Target-minus-Base context", async () => {
    await act(async () =>
      root.render(
        <ComparisonReport
          data={comparison}
          baseName="autosave_99_temp.hoi4"
          targetName="autosave_100_temp.hoi4"
          selectedCountryTag="GER"
          onBack={() => undefined}
        />,
      ),
    );
    expect(container.textContent).toContain("Target − Base");
    expect(container.textContent).toContain("280");
    expect(container.textContent).toContain("286");
    expect(container.textContent).toContain("+6");
    expect(container.textContent).toContain("Target only");
    expect(container.textContent).toContain("Base only");
    expect(container.textContent).toContain("Campaign relationship: different");
    expect(container.textContent).toContain("Game-version relationship: different");
  });

  test("uses raw campaign snapshots for first, latest and observed maxima", async () => {
    await act(async () =>
      root.render(
        <CampaignReport
          campaign={campaign}
          context={{ scope: "global", countryTag: null }}
          onBack={() => undefined}
        />,
      ),
    );
    expect(container.textContent).toContain("Germany Campaign");
    expect(container.textContent).toContain("3 analyzed saves");
    expect(container.textContent).toContain("1 February 1936");
    expect(container.textContent).toContain("1 April 1936");
    expect(container.textContent).toContain("changed from 10 to 15 (+5)");
    expect(container.textContent).toContain("Highest observed military factories");
    expect(container.textContent).toContain("1936.3.1 · 20");
    expect(container.querySelector(".report-chart")?.textContent).toContain(
      "Raw values",
    );
    expect(container.textContent).not.toContain("moving average");
    expect(container.textContent).not.toContain("normalized");
  });
});
