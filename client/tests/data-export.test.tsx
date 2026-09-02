import { describe, expect, test, vi } from "vitest";
import type { AnalyzeResult } from "@/types";
import type { AnalysisComparisonDto } from "@/types/analysis-comparison";
import type { CampaignTrend } from "@/types/campaign-trends";
import {
  buildCampaignExport,
  buildComparisonExport,
  buildSingleSaveExport,
  campaignCsv,
  comparisonCsv,
  createCsv,
  downloadTextFile,
  sanitizeFilenamePart,
  singleSaveCsv,
} from "@/lib/data-export";

const analyzed = {
  game_date: "1944.5.1",
  file_size_mb: 104,
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
    {
      tag: "GER",
      divisions: 200,
      manpowerInField: 2_000_000,
      aircraft: 4000,
      ships: 80,
      effectiveMilitaryFactories: 286,
      effectiveCivilianFactories: 228,
      effectiveDockyards: 39,
      calculatedWarCasualtiesTotal: 10_578_996,
    },
  ],
  navalLosses: [{ event: {} }],
} as unknown as AnalyzeResult;

const comparison: AnalysisComparisonDto = {
  baseHash: "a".repeat(64),
  targetHash: "b".repeat(64),
  baseGameDate: "1944.4.1",
  targetGameDate: "1944.5.1",
  context: {
    chronology: "target_after_base",
    sameAnalysis: false,
    campaignCompatibility: "same",
    gameVersionCompatibility: "same",
  },
  hasChanges: true,
  summary: {
    activeCountries: { before: 95, after: 96, delta: 1 },
    divisions: { before: 3200, after: 3250, delta: 50 },
    manpowerInField: { before: 31_000_000, after: 31_378_714, delta: 378_714 },
    aircraft: { before: 54_000, after: 53_095, delta: -905 },
    ships: { before: 1540, after: 1539, delta: -1 },
    navalLossCount: { before: 990, after: 993, delta: 3 },
  },
  countries: [
    {
      tag: "GER",
      status: "unchanged",
      hasChanges: true,
      effectiveMilitaryFactories: { before: 280, after: 286, delta: 6 },
      effectiveCivilianFactories: { before: 230, after: 228, delta: -2 },
      effectiveDockyards: { before: 39, after: 39, delta: 0 },
      divisions: { before: 199, after: 200, delta: 1 },
      manpowerInField: { before: 1_990_000, after: 2_000_000, delta: 10_000 },
      ships: { before: 81, after: 80, delta: -1 },
      calculatedWarCasualtiesTotal: {
        before: 10_000_000,
        after: 10_578_996,
        delta: 578_996,
      },
    },
    {
      tag: "D04",
      status: "added",
      hasChanges: true,
      effectiveMilitaryFactories: { before: null, after: 2, delta: null },
      effectiveCivilianFactories: { before: null, after: 1, delta: null },
      effectiveDockyards: { before: null, after: 0, delta: null },
      divisions: { before: null, after: 1, delta: null },
      manpowerInField: { before: null, after: 8000, delta: null },
      ships: { before: null, after: 0, delta: null },
      calculatedWarCasualtiesTotal: { before: null, after: 0, delta: null },
    },
  ],
};

const campaign: CampaignTrend = {
  key: "campaign:test",
  campaignId: "0731c3c7-035e-46b1-b07b-6c35b27e8dc2",
  playerCountryTag: "GER",
  relationship: "known",
  snapshotCount: 2,
  firstGameDate: "1936.2.1",
  latestGameDate: "1936.3.1",
  gameVersions: ["1.16.4"],
  snapshots: [1, 2].map((sequence) => ({
    hash: String(sequence).repeat(64),
    fileName: `autosave_${sequence}.hoi4`,
    gameDate: `1936.${sequence + 1}.1`,
    analyzedAt: `2026-01-0${sequence}T00:00:00.000Z`,
    gameVersion: "1.16.4",
    metrics: {
      activeCountries: 80 + sequence,
      divisions: 100 + sequence,
      manpowerInField: 1_000_000 + sequence,
      aircraft: 200 + sequence,
      ships: 30 + sequence,
      militaryFactories: 40 + sequence,
      civilianFactories: 50 + sequence,
      dockyards: 10 + sequence,
    },
    countries: [
      {
        tag: "GER",
        metrics: {
          divisions: 10 + sequence,
          manpowerInField: 100_000 + sequence,
          aircraft: 20 + sequence,
          ships: 3 + sequence,
          militaryFactories: 4 + sequence,
          civilianFactories: 5 + sequence,
          dockyards: 1 + sequence,
          calculatedCasualties: 1000 + sequence,
        },
      },
    ],
  })),
};

describe("data export", () => {
  test("creates standards-friendly CSV with Unicode, escaping and nulls", () => {
    const csv = createCsv(["text", "number", "missing"], [
      { text: 'Möwe, "Potosí"\nnext', number: -42, missing: null },
    ]);
    expect(csv).toBe(
      'text,number,missing\r\n"Möwe, ""Potosí""\nnext",-42,',
    );
  });

  test("protects formula-like text without corrupting negative numbers", () => {
    const csv = createCsv(["a", "b", "c", "d", "numeric"], [
      { a: "=1+1", b: "+cmd", c: "-text", d: "@name", numeric: -7.5 },
    ]);
    expect(csv.split("\r\n")[1]).toBe("'=1+1,'+cmd,'-text,'@name,-7.5");
  });

  test("sanitizes unsafe filename characters", () => {
    expect(sanitizeFilenamePart(' autosave: 100/GER*? "final" ')).toBe(
      "autosave-100-GER-final",
    );
  });

  test("builds a curated single-save JSON and country CSV", () => {
    const value = buildSingleSaveExport(
      analyzed,
      { fileName: "autosave_100_temp.hoi4", analysisHash: "a".repeat(64) },
      "2026-01-01T00:00:00.000Z",
    );
    expect(value).toMatchObject({
      exportType: "hoi4-save-analysis",
      formatVersion: 1,
      save: { gameDate: "1944.5.1", fileName: "autosave_100_temp.hoi4" },
      totals: { divisions: 3250, recordedNavalLosses: 1 },
    });
    expect(value.countries[0]).toMatchObject({
      countryTag: "GER",
      countryName: "Germany",
      effectiveMilitaryFactories: 286,
      calculatedWarCasualties: 10_578_996,
    });
    const csv = singleSaveCsv(analyzed, { fileName: "autosave_100_temp.hoi4" });
    expect(csv).toContain("effectiveMilitaryFactories");
    expect(csv).toContain("autosave_100_temp.hoi4");
    expect(csv).toContain("GER,Germany,286,228,39");
  });

  test("exports the existing comparison with Target minus Base semantics", () => {
    const context = { baseName: "base.hoi4", targetName: "target.hoi4" };
    const value = buildComparisonExport(
      comparison,
      context,
      "2026-01-01T00:00:00.000Z",
    );
    expect(value.deltaSemantics).toBe("target-minus-base");
    expect(value.context.chronology).toBe("target_after_base");
    expect(value.countries[0].effectiveMilitaryFactories).toEqual({
      before: 280,
      after: 286,
      delta: 6,
    });
    expect(value.countries[1]).toMatchObject({ status: "added" });
    const csv = comparisonCsv(comparison, context);
    expect(csv).toContain("effectiveMilitaryFactoriesBase");
    expect(csv).toContain("280,286,6");
    expect(csv).toContain("D04,D04,added");
  });

  test("exports every underlying campaign snapshot with raw values", () => {
    const value = buildCampaignExport(
      campaign,
      { scope: "country", countryTag: "GER" },
      "2026-01-01T00:00:00.000Z",
    );
    expect(value.values).toBe("raw-snapshot-values");
    expect(value.snapshots).toHaveLength(2);
    expect(value.snapshots[0]).toMatchObject({
      snapshotSequence: 1,
      globalDivisions: 101,
      selectedCountryTag: "GER",
      countryDivisions: 11,
    });
    const csv = campaignCsv(campaign, {
      scope: "country",
      countryTag: "GER",
    });
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).toContain("globalDivisions");
    expect(csv).toContain("countryDivisions");
    expect(csv).toContain("1936.2.1");
    expect(csv).toContain("1936.3.1");
  });

  test("revokes the download URL after the browser receives the click", () => {
    vi.useFakeTimers();
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:export");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    try {
      downloadTextFile("countryTag\r\nGER", "test.csv", "text/csv");
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(click).toHaveBeenCalledOnce();
      expect(revokeObjectURL).not.toHaveBeenCalled();

      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
    } finally {
      vi.useRealTimers();
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
      click.mockRestore();
    }
  });
});
