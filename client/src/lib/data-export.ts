import type { AnalyzeResult, CountryStats } from "@/types";
import type { AnalysisComparisonDto } from "@/types/analysis-comparison";
import type {
  CampaignTrend,
  CampaignTrendSnapshot,
} from "@/types/campaign-trends";
import { countryFullName } from "@/lib/utils";

export const EXPORT_FORMAT_VERSION = 1;

export type CsvCell = string | number | boolean | null | undefined;

export interface SingleSaveExportContext {
  fileName?: string | null;
  analysisHash?: string | null;
}

export interface ComparisonExportContext {
  baseName: string;
  targetName: string;
}

export interface CampaignExportContext {
  scope: "global" | "country";
  countryTag?: string | null;
}

const SINGLE_COUNTRY_COLUMNS = [
  "exportType",
  "gameDate",
  "saveFileName",
  "analysisHash",
  "countryTag",
  "countryName",
  "effectiveMilitaryFactories",
  "effectiveCivilianFactories",
  "effectiveDockyards",
  "divisions",
  "manpowerInField",
  "aircraft",
  "ships",
  "calculatedWarCasualties",
] as const;

const COMPARISON_METRICS = [
  "effectiveMilitaryFactories",
  "effectiveCivilianFactories",
  "effectiveDockyards",
  "divisions",
  "manpowerInField",
  "ships",
  "calculatedWarCasualtiesTotal",
] as const;

const TREND_GLOBAL_METRICS = [
  "activeCountries",
  "divisions",
  "manpowerInField",
  "aircraft",
  "ships",
  "militaryFactories",
  "civilianFactories",
  "dockyards",
] as const;

const TREND_COUNTRY_METRICS = [
  "divisions",
  "manpowerInField",
  "aircraft",
  "ships",
  "militaryFactories",
  "civilianFactories",
  "dockyards",
  "calculatedCasualties",
] as const;

function protectCsvText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "";
  const text = protectCsvText(typeof value === "boolean" ? String(value) : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function createCsv(
  columns: readonly string[],
  rows: readonly Record<string, CsvCell>[],
): string {
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\r\n");
}

export function sanitizeFilenamePart(value: string): string {
  const safeCharacters = [...value.normalize("NFKC")]
    .map((character) =>
      character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
        ? "-"
        : character,
    )
    .join("");
  const sanitized = safeCharacters
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100);
  return sanitized || "unknown";
}

function filenameDate(value: string | null | undefined): string {
  const match = /^(\d{1,4})\.(\d{1,2})\.(\d{1,2})(?:\.\d{1,2})?$/.exec(
    value ?? "",
  );
  if (!match) return "unknown-date";
  return `${match[1].padStart(4, "0")}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

export function singleSaveExportFilename(
  gameDate: string,
  extension: "csv" | "json",
): string {
  return `hoi4-save-${filenameDate(gameDate)}.${extension}`;
}

export function comparisonExportFilename(
  baseDate: string | null,
  targetDate: string | null,
  extension: "csv" | "json",
): string {
  return `hoi4-compare-${filenameDate(baseDate)}-to-${filenameDate(targetDate)}.${extension}`;
}

export function campaignExportFilename(
  campaign: CampaignTrend,
  extension: "csv" | "json",
): string {
  return `hoi4-campaign-${filenameDate(campaign.firstGameDate)}-to-${filenameDate(campaign.latestGameDate)}.${extension}`;
}

function singleCountryRow(
  country: CountryStats,
  result: AnalyzeResult,
  context: SingleSaveExportContext,
): Record<string, CsvCell> {
  return {
    exportType: "hoi4-save-country-summary",
    gameDate: result.game_date,
    saveFileName: context.fileName ?? null,
    analysisHash: context.analysisHash ?? null,
    countryTag: country.tag,
    countryName: countryFullName(country.tag),
    effectiveMilitaryFactories: country.effectiveMilitaryFactories,
    effectiveCivilianFactories: country.effectiveCivilianFactories,
    effectiveDockyards: country.effectiveDockyards,
    divisions: country.divisions,
    manpowerInField: country.manpowerInField,
    aircraft: country.aircraft,
    ships: country.ships,
    calculatedWarCasualties: country.calculatedWarCasualtiesTotal ?? null,
  };
}

export function buildSingleSaveExport(
  result: AnalyzeResult,
  context: SingleSaveExportContext = {},
  generatedAt = new Date().toISOString(),
) {
  const countries = result.by_country.map((country) =>
    singleCountryRow(country, result, context),
  );
  return {
    exportType: "hoi4-save-analysis",
    formatVersion: EXPORT_FORMAT_VERSION,
    generatedAt,
    save: {
      fileName: context.fileName ?? null,
      analysisHash: context.analysisHash ?? null,
      gameDate: result.game_date,
      fileSizeMb: result.file_size_mb,
    },
    totals: {
      activeCountries: result.active_countries,
      divisions: result.totals.divisions,
      manpowerInField: result.totals.manpowerInField,
      aircraft: result.totals.aircraft,
      ships: result.totals.ships,
      effectiveMilitaryFactories: result.totals.effectiveMilitaryFactories,
      effectiveCivilianFactories: result.totals.effectiveCivilianFactories,
      effectiveDockyards: result.totals.effectiveDockyards,
      recordedNavalLosses: result.navalLosses.length,
      calculatedWarCasualties:
        result.calculatedWarCasualtiesTotal ??
        result.totals.calculatedWarCasualtiesTotal ??
        null,
    },
    countries,
  };
}

export function singleSaveCsv(
  result: AnalyzeResult,
  context: SingleSaveExportContext = {},
): string {
  return createCsv(
    SINGLE_COUNTRY_COLUMNS,
    result.by_country.map((country) => singleCountryRow(country, result, context)),
  );
}

export function buildComparisonExport(
  data: AnalysisComparisonDto,
  context: ComparisonExportContext,
  generatedAt = new Date().toISOString(),
) {
  return {
    exportType: "hoi4-save-comparison",
    formatVersion: EXPORT_FORMAT_VERSION,
    generatedAt,
    base: {
      analysisHash: data.baseHash,
      fileName: context.baseName,
      gameDate: data.baseGameDate,
    },
    target: {
      analysisHash: data.targetHash,
      fileName: context.targetName,
      gameDate: data.targetGameDate,
    },
    context: data.context,
    hasChanges: data.hasChanges,
    deltaSemantics: "target-minus-base",
    summary: data.summary,
    countries: data.countries.map((country) => ({
      countryTag: country.tag,
      countryName: countryFullName(country.tag),
      status: country.status,
      hasChanges: country.hasChanges,
      ...Object.fromEntries(
        COMPARISON_METRICS.map((metric) => [metric, country[metric]]),
      ),
    })),
  };
}

export function comparisonCsv(
  data: AnalysisComparisonDto,
  context: ComparisonExportContext,
): string {
  const columns = [
    "baseFileName",
    "baseGameDate",
    "targetFileName",
    "targetGameDate",
    "deltaSemantics",
    "countryTag",
    "countryName",
    "status",
    "hasChanges",
    ...COMPARISON_METRICS.flatMap((metric) => [
      `${metric}Base`,
      `${metric}Target`,
      `${metric}Delta`,
    ]),
  ];
  const rows = data.countries.map((country) => {
    const row: Record<string, CsvCell> = {
      baseFileName: context.baseName,
      baseGameDate: data.baseGameDate,
      targetFileName: context.targetName,
      targetGameDate: data.targetGameDate,
      deltaSemantics: "target-minus-base",
      countryTag: country.tag,
      countryName: countryFullName(country.tag),
      status: country.status,
      hasChanges: country.hasChanges,
    };
    for (const metric of COMPARISON_METRICS) {
      row[`${metric}Base`] = country[metric].before;
      row[`${metric}Target`] = country[metric].after;
      row[`${metric}Delta`] = country[metric].delta;
    }
    return row;
  });
  return createCsv(columns, rows);
}

function campaignSnapshotRow(
  snapshot: CampaignTrendSnapshot,
  sequence: number,
  campaign: CampaignTrend,
  context: CampaignExportContext,
): Record<string, CsvCell> {
  const selectedTag = context.scope === "country" ? context.countryTag ?? null : null;
  const selected = selectedTag
    ? snapshot.countries.find(({ tag }) => tag === selectedTag) ?? null
    : null;
  const row: Record<string, CsvCell> = {
    campaignId: campaign.campaignId,
    playerCountryTag: campaign.playerCountryTag,
    playerCountryName: campaign.playerCountryTag
      ? countryFullName(campaign.playerCountryTag)
      : null,
    scope: context.scope,
    selectedCountryTag: selectedTag,
    selectedCountryName: selectedTag ? countryFullName(selectedTag) : null,
    snapshotSequence: sequence,
    analysisHash: snapshot.hash,
    saveFileName: snapshot.fileName,
    gameDate: snapshot.gameDate,
    analyzedAt: snapshot.analyzedAt,
    gameVersion: snapshot.gameVersion,
  };
  for (const metric of TREND_GLOBAL_METRICS)
    row[`global${metric.charAt(0).toUpperCase()}${metric.slice(1)}`] =
      snapshot.metrics[metric];
  if (context.scope === "country")
    for (const metric of TREND_COUNTRY_METRICS)
      row[`country${metric.charAt(0).toUpperCase()}${metric.slice(1)}`] =
        selected?.metrics[metric] ?? null;
  return row;
}

export function buildCampaignExport(
  campaign: CampaignTrend,
  context: CampaignExportContext,
  generatedAt = new Date().toISOString(),
) {
  return {
    exportType: "hoi4-campaign-trends",
    formatVersion: EXPORT_FORMAT_VERSION,
    generatedAt,
    campaign: {
      campaignId: campaign.campaignId,
      relationship: campaign.relationship,
      playerCountryTag: campaign.playerCountryTag,
      playerCountryName: campaign.playerCountryTag
        ? countryFullName(campaign.playerCountryTag)
        : null,
      firstGameDate: campaign.firstGameDate,
      latestGameDate: campaign.latestGameDate,
      snapshotCount: campaign.snapshotCount,
      scope: context.scope,
      selectedCountryTag:
        context.scope === "country" ? context.countryTag ?? null : null,
      selectedCountryName:
        context.scope === "country" && context.countryTag
          ? countryFullName(context.countryTag)
          : null,
    },
    values: "raw-snapshot-values",
    snapshots: campaign.snapshots.map((snapshot, index) =>
      campaignSnapshotRow(snapshot, index + 1, campaign, context),
    ),
  };
}

export function campaignCsv(
  campaign: CampaignTrend,
  context: CampaignExportContext,
): string {
  const columns = [
    "campaignId",
    "playerCountryTag",
    "playerCountryName",
    "scope",
    "selectedCountryTag",
    "selectedCountryName",
    "snapshotSequence",
    "analysisHash",
    "saveFileName",
    "gameDate",
    "analyzedAt",
    "gameVersion",
    ...TREND_GLOBAL_METRICS.map(
      (metric) => `global${metric.charAt(0).toUpperCase()}${metric.slice(1)}`,
    ),
    ...(context.scope === "country"
      ? TREND_COUNTRY_METRICS.map(
          (metric) =>
            `country${metric.charAt(0).toUpperCase()}${metric.slice(1)}`,
        )
      : []),
  ];
  return createCsv(
    columns,
    campaign.snapshots.map((snapshot, index) =>
      campaignSnapshotRow(snapshot, index + 1, campaign, context),
    ),
  );
}

export function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function downloadTextFile(
  content: string,
  filename: string,
  mimeType: "text/csv" | "application/json",
): void {
  const payload = mimeType === "text/csv" ? `\uFEFF${content}` : content;
  const url = URL.createObjectURL(new Blob([payload], { type: `${mimeType};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = sanitizeFilenamePart(filename.replace(/\.(csv|json)$/i, "")) +
    (filename.toLowerCase().endsWith(".csv") ? ".csv" : ".json");
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
