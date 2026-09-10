import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SaveRecord } from "@/types";
import { apiFetch } from "@/lib/api-client";
import type {
  CampaignTrend,
  CampaignEquipmentTrendsDto,
  CampaignTrendSnapshot,
  CampaignTrendsDto,
  CountryTrendMetric,
  GlobalTrendMetric,
  TrendMetric,
  EquipmentTrendMetric,
} from "@/types/campaign-trends";
import { ExportControls } from "@/components/ui/ExportControls";
import {
  buildCampaignExport,
  campaignCsv,
  campaignExportFilename,
  prettyJson,
} from "@/lib/data-export";
import { CampaignReport } from "@/components/reports/CampaignReport";
import { usePlotTheme } from "@/hooks/usePlotTheme";
import {
  countryFullName,
  formatEquipmentDefinition,
  resolvePreferredCountryTag,
} from "@/lib/utils";
import { ANALYZER_UNAVAILABLE_MESSAGE } from "@/lib/analysis-error";

const Plot = React.lazy(() => import("react-plotly.js"));

type TrendScope = "global" | "country";
type TrendMode = "overview" | "equipment";
type XMode = "game_date" | "sequence";
type PresetName = "Military Growth" | "Industry Growth" | "World Overview";

interface TrendSettings {
  scope: TrendScope;
  metrics: TrendMetric[];
  preset: PresetName | "Custom";
  xMode: XMode;
  normalize: boolean;
  movingAverage: 1 | 3 | 5 | 10;
  onePerGameDate: boolean;
  separateScale: boolean;
}

interface MetricDefinition {
  key: TrendMetric;
  label: string;
  shortLabel: string;
  color: string;
  global: boolean;
  country: boolean;
}

interface TrendPreset {
  metrics: TrendMetric[];
  normalize: boolean;
}

const METRICS: readonly MetricDefinition[] = [
  {
    key: "divisions",
    label: "Divisions",
    shortLabel: "Divisions",
    color: "#2aa198",
    global: true,
    country: true,
  },
  {
    key: "manpowerInField",
    label: "Manpower in field",
    shortLabel: "Manpower",
    color: "#4d8fd6",
    global: true,
    country: true,
  },
  {
    key: "aircraft",
    label: "Aircraft",
    shortLabel: "Aircraft",
    color: "#8d77d8",
    global: true,
    country: true,
  },
  {
    key: "ships",
    label: "Ships",
    shortLabel: "Ships",
    color: "#d49a45",
    global: true,
    country: true,
  },
  {
    key: "activeCountries",
    label: "Active countries",
    shortLabel: "Countries",
    color: "#6da96b",
    global: true,
    country: false,
  },
  {
    key: "militaryFactories",
    label: "Military factories",
    shortLabel: "MIL",
    color: "#c96767",
    global: true,
    country: true,
  },
  {
    key: "civilianFactories",
    label: "Civilian factories",
    shortLabel: "CIV",
    color: "#6da7a3",
    global: true,
    country: true,
  },
  {
    key: "dockyards",
    label: "Dockyards",
    shortLabel: "Dockyards",
    color: "#507da8",
    global: true,
    country: true,
  },
  {
    key: "calculatedCasualties",
    label: "Calculated casualties",
    shortLabel: "Casualties",
    color: "#a87878",
    global: false,
    country: true,
  },
];

const PRESETS: Record<PresetName, TrendPreset> = {
  "Military Growth": {
    metrics: ["divisions", "manpowerInField", "aircraft", "ships"],
    normalize: true,
  },
  "Industry Growth": {
    metrics: ["militaryFactories", "civilianFactories", "dockyards"],
    normalize: false,
  },
  "World Overview": {
    metrics: ["activeCountries", "divisions", "aircraft", "ships"],
    normalize: true,
  },
};

const DEFAULT_SETTINGS: TrendSettings = {
  scope: "global",
  metrics: [...PRESETS["Military Growth"].metrics],
  preset: "Military Growth",
  xMode: "game_date",
  normalize: PRESETS["Military Growth"].normalize,
  movingAverage: 1,
  onePerGameDate: false,
  separateScale: false,
};

const SETTINGS_KEY = "hoi4-campaign-trends-v1";
const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const EQUIPMENT_METRICS: Record<
  EquipmentTrendMetric,
  { label: string; shortLabel: string; color: string }
> = {
  stockpileBalance: {
    label: "Stockpile balance",
    shortLabel: "Stockpile",
    color: "#2aa198",
  },
  activeFactories: {
    label: "Active factory slots",
    shortLabel: "Factories",
    color: "#c96767",
  },
  currentItemsPerDay: {
    label: "Current production rate/day",
    shortLabel: "Rate/day",
    color: "#4d8fd6",
  },
};

function loadSettings(): TrendSettings {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(SETTINGS_KEY) ?? "null",
    ) as Partial<TrendSettings> | null;
    if (!parsed) return DEFAULT_SETTINGS;
    const metrics = Array.isArray(parsed.metrics)
      ? parsed.metrics.filter((metric): metric is TrendMetric =>
          METRICS.some(({ key }) => key === metric),
        )
      : DEFAULT_SETTINGS.metrics;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      metrics: metrics.length ? metrics : DEFAULT_SETTINGS.metrics,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: TrendSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings persistence is optional.
  }
}

function isTrendsDto(value: unknown): value is CampaignTrendsDto {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as CampaignTrendsDto).campaigns) &&
    typeof (value as CampaignTrendsDto).snapshotCount === "number"
  );
}

function isEquipmentTrendsDto(
  value: unknown,
): value is CampaignEquipmentTrendsDto {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as CampaignEquipmentTrendsDto).campaignKey === "string" &&
    typeof (value as CampaignEquipmentTrendsDto).countryTag === "string" &&
    Array.isArray((value as CampaignEquipmentTrendsDto).snapshotHashes) &&
    Array.isArray((value as CampaignEquipmentTrendsDto).definitions)
  );
}

function shortCampaignId(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function campaignLabel(campaign: CampaignTrend): string {
  if (campaign.playerCountryTag)
    return countryFullName(campaign.playerCountryTag);
  return campaign.campaignId ? "Known campaign" : "Legacy campaign";
}

function campaignDateRange(campaign: CampaignTrend): string {
  const first = campaign.firstGameDate ?? "Unknown date";
  const latest = campaign.latestGameDate ?? "Unknown date";
  return `${first} → ${latest}`;
}

function campaignOptionLabel(campaign: CampaignTrend): string {
  const saves = `save${campaign.snapshotCount === 1 ? "" : "s"}`;
  return [
    campaignLabel(campaign),
    campaignDateRange(campaign),
    `${campaign.snapshotCount} ${saves}`,
  ].join(" · ");
}

function availableMetrics(scope: TrendScope): MetricDefinition[] {
  return METRICS.filter((metric) =>
    scope === "global" ? metric.global : metric.country,
  );
}

function metricDefinition(key: TrendMetric): MetricDefinition {
  return METRICS.find((metric) => metric.key === key) ?? METRICS[0];
}

function metricValue(
  snapshot: CampaignTrendSnapshot,
  scope: TrendScope,
  countryTag: string,
  metric: TrendMetric,
): number | null {
  if (scope === "global")
    return snapshot.metrics[metric as GlobalTrendMetric] ?? null;
  const country = snapshot.countries.find(({ tag }) => tag === countryTag);
  return country?.metrics[metric as CountryTrendMetric] ?? null;
}

function movingAverage(
  values: readonly (number | null)[],
  window: number,
): (number | null)[] {
  if (window <= 1) return [...values];
  const history: number[] = [];
  return values.map((value) => {
    if (value === null || !Number.isFinite(value)) {
      history.length = 0;
      return null;
    }
    history.push(value);
    if (history.length > window) history.shift();
    return history.reduce((sum, entry) => sum + entry, 0) / history.length;
  });
}

function normalize(values: readonly (number | null)[]): (number | null)[] {
  const finite = values.filter((value): value is number => value !== null);
  if (!finite.length) return [...values];
  const minimum = Math.min(...finite);
  const maximum = Math.max(...finite);
  return values.map((value) =>
    value === null
      ? null
      : maximum === minimum
        ? 0.5
        : (value - minimum) / (maximum - minimum),
  );
}

function onePerDate(
  snapshots: readonly CampaignTrendSnapshot[],
): CampaignTrendSnapshot[] {
  const selected = new Map<string, CampaignTrendSnapshot>();
  const undated: CampaignTrendSnapshot[] = [];
  for (const snapshot of snapshots) {
    if (!/^\d+\.\d{1,2}\.\d{1,2}$/.test(snapshot.gameDate)) {
      undated.push(snapshot);
      continue;
    }
    const previous = selected.get(snapshot.gameDate);
    if (
      !previous ||
      Date.parse(snapshot.analyzedAt) >= Date.parse(previous.analyzedAt)
    )
      selected.set(snapshot.gameDate, snapshot);
  }
  return snapshots.filter(
    (snapshot) =>
      undated.includes(snapshot) ||
      selected.get(snapshot.gameDate) === snapshot,
  );
}

function average(
  values: readonly (number | null | undefined)[],
): number | null {
  const finite = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  return finite.length
    ? finite.reduce((sum, value) => sum + value, 0) / finite.length
    : null;
}

function formatValue(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : NUMBER.format(value);
}

function activateRow(
  event: React.KeyboardEvent<HTMLTableRowElement>,
  activate: () => void,
): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

function plotDate(value: string): string | null {
  const match = /^(\d{1,4})\.(\d{1,2})\.(\d{1,2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = match[1].padStart(4, "0");
  const normalizedMonth = match[2].padStart(2, "0");
  const normalizedDay = match[3].padStart(2, "0");
  return `${year}-${normalizedMonth}-${normalizedDay}`;
}

export function CampaignTrends({
  telemetry,
  telemetryLoading,
  telemetryError,
  reloadTelemetry,
  onAnalyzeSave,
  onImportCampaign,
}: {
  telemetry: SaveRecord[];
  telemetryLoading: boolean;
  telemetryError: string | null;
  reloadTelemetry: () => void;
  onAnalyzeSave?: () => void;
  onImportCampaign?: () => void;
}) {
  const plotTheme = usePlotTheme();
  const request = useRef<AbortController | null>(null);
  const equipmentRequest = useRef<AbortController | null>(null);
  const equipmentCache = useRef(new Map<string, CampaignEquipmentTrendsDto>());
  const countryCampaignKey = useRef<string | null>(null);
  const [data, setData] = useState<CampaignTrendsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [campaignKey, setCampaignKey] = useState("");
  const [countryTag, setCountryTag] = useState("");
  const [selectedHash, setSelectedHash] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [trendMode, setTrendMode] = useState<TrendMode>("overview");
  const [equipmentData, setEquipmentData] =
    useState<CampaignEquipmentTrendsDto | null>(null);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [equipmentError, setEquipmentError] = useState("");
  const [equipmentDefinitionKey, setEquipmentDefinitionKey] = useState("");
  const [equipmentMetric, setEquipmentMetric] =
    useState<EquipmentTrendMetric>("stockpileBalance");
  const [equipmentRevision, setEquipmentRevision] = useState(0);
  const [settings, setSettings] = useState<TrendSettings>(loadSettings);

  const updateSettings = useCallback((patch: Partial<TrendSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      if (next.normalize) next.separateScale = false;
      saveSettings(next);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    let reachedService = false;
    try {
      const response = await apiFetch("/api/analyze/trends", {
        signal: controller.signal,
      });
      reachedService = true;
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isTrendsDto(body))
        throw new Error("Could not load campaign trend data.");
      setData(body);
      setCampaignKey((current) =>
        body.campaigns.some(({ key }) => key === current)
          ? current
          : (body.campaigns[0]?.key ?? ""),
      );
    } catch (failure: unknown) {
      if ((failure as DOMException).name !== "AbortError")
        setError(
          reachedService
            ? "Campaign trend data could not be loaded. Try again."
            : `Campaign trends are temporarily unavailable. ${ANALYZER_UNAVAILABLE_MESSAGE}`,
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      request.current?.abort();
      equipmentRequest.current?.abort();
    };
  }, [load]);

  const campaign = useMemo(
    () => data?.campaigns.find(({ key }) => key === campaignKey) ?? null,
    [campaignKey, data],
  );
  const countries = useMemo(
    () =>
      [
        ...new Set(
          campaign?.snapshots.flatMap((snapshot) =>
            snapshot.countries.map(({ tag }) => tag),
          ) ?? [],
        ),
      ].sort((left, right) =>
        countryFullName(left).localeCompare(countryFullName(right)),
      ),
    [campaign],
  );

  useEffect(() => {
    const currentCampaignKey = campaign?.key ?? null;
    const campaignChanged = countryCampaignKey.current !== currentCampaignKey;
    countryCampaignKey.current = currentCampaignKey;
    if (!campaignChanged && countries.includes(countryTag)) return;
    setCountryTag(
      resolvePreferredCountryTag(countries, campaign?.playerCountryTag) ?? "",
    );
  }, [campaign?.key, campaign?.playerCountryTag, countries, countryTag]);

  useEffect(() => {
    if (trendMode !== "equipment" || !campaign || !countryTag) return;
    const cacheKey = `${campaign.key}\u0000${countryTag}`;
    const cached = equipmentCache.current.get(cacheKey);
    if (cached) {
      setEquipmentData(cached);
      setEquipmentError("");
      setEquipmentLoading(false);
      return;
    }

    equipmentRequest.current?.abort();
    const controller = new AbortController();
    equipmentRequest.current = controller;
    setEquipmentData(null);
    setEquipmentError("");
    setEquipmentLoading(true);
    void (async () => {
      try {
        const query = new URLSearchParams({
          campaignKey: campaign.key,
          countryTag,
        });
        const response = await apiFetch(
          `/api/analyze/trends/equipment?${query.toString()}`,
          { signal: controller.signal },
        );
        const body: unknown = await response.json().catch(() => null);
        if (
          !response.ok ||
          !isEquipmentTrendsDto(body) ||
          body.campaignKey !== campaign.key ||
          body.countryTag !== countryTag
        )
          throw new Error("Invalid equipment trend response");
        equipmentCache.current.set(cacheKey, body);
        setEquipmentData(body);
      } catch (failure: unknown) {
        if ((failure as DOMException).name !== "AbortError")
          setEquipmentError(
            "Equipment trend data could not be loaded. Try again.",
          );
      } finally {
        if (equipmentRequest.current === controller) {
          equipmentRequest.current = null;
          setEquipmentLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [campaign, countryTag, equipmentRevision, trendMode]);

  useEffect(() => {
    const definitions = equipmentData?.definitions ?? [];
    if (
      !definitions.some(
        ({ equipmentDefinition }) =>
          equipmentDefinition === equipmentDefinitionKey,
      )
    )
      setEquipmentDefinitionKey(definitions[0]?.equipmentDefinition ?? "");
  }, [equipmentData, equipmentDefinitionKey]);

  const snapshots = useMemo(
    () =>
      settings.onePerGameDate
        ? onePerDate(campaign?.snapshots ?? [])
        : [...(campaign?.snapshots ?? [])],
    [campaign, settings.onePerGameDate],
  );

  useEffect(() => {
    if (!snapshots.some(({ hash }) => hash === selectedHash))
      setSelectedHash(snapshots.at(-1)?.hash ?? "");
  }, [selectedHash, snapshots]);

  const supported = availableMetrics(settings.scope);
  const selectedMetrics = settings.metrics.filter((key) =>
    supported.some((metric) => metric.key === key),
  );
  const effectiveMetrics = selectedMetrics.length
    ? selectedMetrics
    : [supported[0]?.key].filter((value): value is TrendMetric => !!value);
  const separateScale =
    trendMode === "overview" &&
    settings.separateScale &&
    !settings.normalize &&
    effectiveMetrics.length <= 3;
  const plottedDates = snapshots.map((snapshot) => plotDate(snapshot.gameDate));
  const useDateAxis =
    settings.xMode === "game_date" &&
    plottedDates.every((value): value is string => value !== null);
  const xValues = snapshots.map((snapshot, index) =>
    settings.xMode === "game_date"
      ? (plottedDates[index] ?? snapshot.gameDate)
      : index + 1,
  );

  const selectedEquipmentDefinition = useMemo(
    () =>
      equipmentData?.definitions.find(
        ({ equipmentDefinition }) =>
          equipmentDefinition === equipmentDefinitionKey,
      ) ?? null,
    [equipmentData, equipmentDefinitionKey],
  );
  const equipmentValues = useMemo(() => {
    if (!equipmentData || !selectedEquipmentDefinition)
      return snapshots.map(() => null);
    const indexByHash = new Map(
      equipmentData.snapshotHashes.map((hash, index) => [hash, index]),
    );
    const values = selectedEquipmentDefinition[equipmentMetric];
    return snapshots.map(({ hash }) => {
      const index = indexByHash.get(hash);
      return index === undefined ? null : (values[index] ?? null);
    });
  }, [equipmentData, equipmentMetric, selectedEquipmentDefinition, snapshots]);
  const equipmentRateState = useMemo(() => {
    if (!equipmentData || !selectedEquipmentDefinition)
      return snapshots.map(() => null);
    const indexByHash = new Map(
      equipmentData.snapshotHashes.map((hash, index) => [hash, index]),
    );
    return snapshots.map(({ hash }) => {
      const index = indexByHash.get(hash);
      return index === undefined
        ? null
        : (selectedEquipmentDefinition.productionRateComplete[index] ?? null);
    });
  }, [equipmentData, selectedEquipmentDefinition, snapshots]);

  const traces = useMemo(() => {
    if (trendMode === "equipment") {
      if (!selectedEquipmentDefinition) return [];
      const definition = EQUIPMENT_METRICS[equipmentMetric];
      const raw = equipmentValues;
      const displayed = movingAverage(raw, settings.movingAverage);
      return [
        {
          type: "scatter" as const,
          mode: "lines+markers" as const,
          name: definition.label,
          x: xValues,
          y: displayed,
          customdata: snapshots.map((snapshot, index) => [
            snapshot.fileName,
            raw[index] === null
              ? equipmentMetric === "currentItemsPerDay" &&
                equipmentRateState[index] === false
                ? "Incomplete rate"
                : "Unavailable"
              : formatValue(raw[index]),
            snapshot.gameDate,
            selectedEquipmentDefinition.equipmentDefinition,
          ]),
          connectgaps: false,
          line: { width: 2.4, color: definition.color },
          marker: {
            size: snapshots.map(({ hash }) => (hash === selectedHash ? 11 : 6)),
            color: definition.color,
            line: {
              width: snapshots.map(({ hash }) =>
                hash === selectedHash ? 2 : 0,
              ),
              color: plotTheme.isDark ? "#f1f5f4" : "#172226",
            },
          },
          hovertemplate:
            `<b>${definition.label}</b><br>` +
            `Equipment: %{customdata[3]}<br>Date: %{customdata[2]}<br>` +
            `Snapshot: %{customdata[1]}<br>%{customdata[0]}<extra></extra>`,
        },
      ];
    }
    return effectiveMetrics.map((metric, metricIndex) => {
      const definition = metricDefinition(metric);
      const raw = snapshots.map((snapshot) =>
        metricValue(snapshot, settings.scope, countryTag, metric),
      );
      const averaged = movingAverage(raw, settings.movingAverage);
      const displayed = settings.normalize ? normalize(averaged) : averaged;
      return {
        type: "scatter" as const,
        mode: "lines+markers" as const,
        name: definition.label,
        x: xValues,
        y: displayed,
        customdata: snapshots.map((snapshot, index) => [
          snapshot.fileName,
          raw[index] === null ? "Unavailable" : formatValue(raw[index]),
          snapshot.gameDate,
        ]),
        connectgaps: false,
        yaxis: separateScale
          ? metricIndex === 0
            ? "y"
            : `y${metricIndex + 1}`
          : "y",
        line: { width: 2.4, color: definition.color },
        marker: {
          size: snapshots.map(({ hash }) => (hash === selectedHash ? 11 : 6)),
          color: definition.color,
          line: {
            width: snapshots.map(({ hash }) => (hash === selectedHash ? 2 : 0)),
            color: plotTheme.isDark ? "#f1f5f4" : "#172226",
          },
        },
        hovertemplate:
          `<b>${definition.label}</b><br>` +
          `Date: %{customdata[2]}<br>Displayed: %{y:,.3f}<br>` +
          `Snapshot: %{customdata[1]}<br>%{customdata[0]}<extra></extra>`,
      };
    });
  }, [
    countryTag,
    equipmentMetric,
    equipmentRateState,
    equipmentValues,
    effectiveMetrics,
    plotTheme.isDark,
    selectedHash,
    separateScale,
    settings.movingAverage,
    settings.normalize,
    settings.scope,
    selectedEquipmentDefinition,
    snapshots,
    trendMode,
    xValues,
  ]);

  const layout = useMemo(() => {
    const layout: Record<string, unknown> = {
      ...plotTheme,
      height: 500,
      margin: { l: 64, r: separateScale ? 72 : 28, t: 38, b: 70 },
      hovermode: "closest",
      legend: { orientation: "h", x: 0, y: 1.12 },
      xaxis: {
        title: settings.xMode === "game_date" ? "Game date" : "Save sequence",
        type: useDateAxis
          ? "date"
          : settings.xMode === "game_date"
            ? "category"
            : "linear",
        tickmode: "auto",
        nticks: settings.xMode === "game_date" ? 8 : undefined,
        tickangle: 0,
        gridcolor: plotTheme.isDark
          ? "rgba(230,238,236,0.08)"
          : "rgba(23,34,38,0.08)",
        zeroline: false,
        automargin: true,
      },
      yaxis: {
        title:
          trendMode === "equipment"
            ? EQUIPMENT_METRICS[equipmentMetric].label
            : settings.normalize
              ? "Relative change (0–1)"
              : "Snapshot value",
        gridcolor: plotTheme.isDark
          ? "rgba(230,238,236,0.08)"
          : "rgba(23,34,38,0.08)",
        zeroline: false,
        automargin: true,
      },
    };
    if (separateScale)
      effectiveMetrics.slice(1).forEach((metric, index) => {
        layout[`yaxis${index + 2}`] = {
          title: metricDefinition(metric).shortLabel,
          overlaying: "y",
          side: "right",
          position: Math.max(0.84, 1 - index * 0.08),
          showgrid: false,
          zeroline: false,
        };
      });
    return layout;
  }, [
    effectiveMetrics,
    equipmentMetric,
    plotTheme,
    separateScale,
    settings.normalize,
    settings.xMode,
    trendMode,
    useDateAxis,
  ]);

  const duplicateDates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const snapshot of campaign?.snapshots ?? [])
      counts.set(snapshot.gameDate, (counts.get(snapshot.gameDate) ?? 0) + 1);
    return counts;
  }, [campaign]);
  const missingValues =
    trendMode === "equipment"
      ? equipmentValues.some((value) => value === null)
      : effectiveMetrics.some((metric) =>
          snapshots.some(
            (snapshot) =>
              metricValue(snapshot, settings.scope, countryTag, metric) ===
              null,
          ),
        );
  const incompleteRateCount =
    trendMode === "equipment" && equipmentMetric === "currentItemsPerDay"
      ? equipmentRateState.filter((value) => value === false).length
      : 0;
  const latest = snapshots.at(-1) ?? null;
  const timelineMetrics = effectiveMetrics.slice(0, 3);
  const chartSummary = `${snapshots.length} campaign snapshots. ${
    trendMode === "equipment"
      ? `${EQUIPMENT_METRICS[equipmentMetric].label} for ${equipmentDefinitionKey}`
      : effectiveMetrics
          .map((metric) => metricDefinition(metric).label)
          .join(", ")
  } plotted by ${
    settings.xMode === "game_date" ? "game date" : "save sequence"
  }.`;

  const applyPreset = (preset: PresetName) => {
    const allowed = availableMetrics(settings.scope);
    const metrics = PRESETS[preset].metrics.filter((key) =>
      allowed.some((metric) => metric.key === key),
    );
    updateSettings({
      preset,
      metrics,
      normalize: PRESETS[preset].normalize,
      separateScale: false,
    });
  };
  const changeScope = (scope: TrendScope) => {
    const allowed = availableMetrics(scope);
    const metrics = settings.metrics.filter((key) =>
      allowed.some((metric) => metric.key === key),
    );
    updateSettings({
      scope,
      metrics: metrics.length
        ? metrics
        : [...PRESETS["Military Growth"].metrics],
      preset: "Custom",
    });
  };
  const refresh = () => {
    equipmentCache.current.clear();
    void load();
    reloadTelemetry();
  };

  if (campaign && reportOpen)
    return (
      <CampaignReport
        campaign={campaign}
        context={{ scope: settings.scope, countryTag }}
        onBack={() => setReportOpen(false)}
      />
    );

  return (
    <main className="campaign-trends" aria-busy={loading}>
      <header className="campaign-trends-header">
        <div>
          <span className="eyebrow">Campaign analytics</span>
          <h1>Campaign Trends</h1>
          <p>Track campaign development across analyzed saves.</p>
        </div>
        <div className="campaign-header-context">
          {campaign && (
            <div
              className="campaign-range"
              aria-label="Selected campaign range"
            >
              <strong>{campaignLabel(campaign)}</strong>
              <span>
                {campaignDateRange(campaign)} · {campaign.snapshotCount} save
                {campaign.snapshotCount === 1 ? "" : "s"}
              </span>
            </div>
          )}
          {campaign && (
            <button
              type="button"
              className="button button-primary"
              onClick={() => setReportOpen(true)}
            >
              View Report
            </button>
          )}
          {campaign && (
            <ExportControls
              label="Export selected campaign trends"
              createCsv={() => ({
                content: campaignCsv(campaign, {
                  scope: settings.scope,
                  countryTag,
                }),
                filename: campaignExportFilename(campaign, "csv"),
              })}
              createJson={() => ({
                content: prettyJson(
                  buildCampaignExport(campaign, {
                    scope: settings.scope,
                    countryTag,
                  }),
                ),
                filename: campaignExportFilename(campaign, "json"),
              })}
            />
          )}
          <button
            className="button button-secondary campaign-refresh"
            onClick={refresh}
            disabled={loading || telemetryLoading}
            aria-label="Refresh campaign trends"
          >
            ↻ Refresh
          </button>
        </div>
      </header>

      {error && data && (
        <div className="recovery-notice campaign-message warning" role="alert">
          <div>
            <strong>Could not refresh campaign trends</strong>
            <span>{error} The existing campaign view remains available.</span>
          </div>
          <button
            className="button button-secondary"
            onClick={() => void load()}
            disabled={loading}
          >
            Try again
          </button>
        </div>
      )}
      {loading && !data && (
        <section className="panel campaign-state" role="status">
          <h2>Loading campaign trends…</h2>
          <p>Reading saved analysis summaries.</p>
        </section>
      )}
      {!loading && error && !data && (
        <section className="panel campaign-state" role="alert">
          <h2>Campaign trends unavailable</h2>
          <p>{error}</p>
          <button
            className="button button-secondary"
            onClick={() => void load()}
          >
            Try again
          </button>
        </section>
      )}
      {!loading && data?.campaigns.length === 0 && (
        <section
          className="panel campaign-state"
          aria-labelledby="campaign-empty-title"
        >
          <h2 id="campaign-empty-title">No campaign trend data yet</h2>
          <p>
            Campaign Trends needs multiple analyzed saves from the same
            campaign. Import a group of .hoi4 saves to build its history.
          </p>
          {(onImportCampaign || onAnalyzeSave) && (
            <div className="product-empty-actions">
              {onImportCampaign && (
                <button
                  className="button button-primary"
                  onClick={onImportCampaign}
                >
                  Import Campaign
                </button>
              )}
              {onAnalyzeSave && (
                <button
                  className="button button-secondary"
                  onClick={onAnalyzeSave}
                >
                  Analyze Save
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {campaign && (
        <>
          {data && data.campaigns.length > 1 && (
            <section
              className="campaign-selector-row"
              aria-label="Campaign selection"
            >
              <label className="field compact-field">
                <span>Campaign</span>
                <select
                  value={campaign.key}
                  onChange={(event) => {
                    setEquipmentData(null);
                    setEquipmentError("");
                    setCampaignKey(event.target.value);
                  }}
                >
                  {data.campaigns.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {campaignOptionLabel(entry)}
                    </option>
                  ))}
                </select>
              </label>
              {campaign.relationship === "unknown" && (
                <p className="campaign-context-note">
                  Campaign identity is unavailable for this legacy analysis. It
                  is not merged with other unknown saves.
                </p>
              )}
            </section>
          )}

          <section
            className="campaign-summary-grid"
            aria-label="Campaign summary"
          >
            <article>
              <span>Analyzed saves</span>
              <strong>{campaign.snapshotCount}</strong>
              <small title={campaign.campaignId ?? undefined}>
                {campaign.campaignId
                  ? `Campaign ID ${shortCampaignId(campaign.campaignId)}`
                  : "Campaign identity unavailable"}
              </small>
            </article>
            <article>
              <span>First game date</span>
              <strong>{campaign.firstGameDate ?? "—"}</strong>
              <small>Earliest valid snapshot</small>
            </article>
            <article>
              <span>Latest game date</span>
              <strong>{campaign.latestGameDate ?? "—"}</strong>
              <small>Latest valid snapshot</small>
            </article>
            <article>
              <span>Campaign span</span>
              <strong className="campaign-span-value">
                {campaign.firstGameDate && campaign.latestGameDate
                  ? `${campaign.firstGameDate} → ${campaign.latestGameDate}`
                  : "—"}
              </strong>
              <small>Exact save dates</small>
            </article>
          </section>

          <section className="panel campaign-chart-panel">
            <div className="campaign-toolbar" aria-label="Trend chart controls">
              {trendMode === "overview" && (
                <label className="field compact-field">
                  <span>Preset</span>
                  <select
                    value={settings.preset}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value !== "Custom") applyPreset(value as PresetName);
                    }}
                  >
                    {Object.keys(PRESETS).map((preset) => (
                      <option key={preset}>{preset}</option>
                    ))}
                    <option>Custom</option>
                  </select>
                </label>
              )}
              <div
                className="campaign-scope"
                role="group"
                aria-label="Trend mode"
              >
                <button
                  type="button"
                  aria-pressed={
                    trendMode === "overview" && settings.scope === "global"
                  }
                  className={
                    trendMode === "overview" && settings.scope === "global"
                      ? "active"
                      : ""
                  }
                  onClick={() => {
                    setTrendMode("overview");
                    if (settings.scope !== "global") changeScope("global");
                  }}
                >
                  Global
                </button>
                <button
                  type="button"
                  aria-pressed={
                    trendMode === "overview" && settings.scope === "country"
                  }
                  className={
                    trendMode === "overview" && settings.scope === "country"
                      ? "active"
                      : ""
                  }
                  onClick={() => {
                    setTrendMode("overview");
                    if (settings.scope !== "country") changeScope("country");
                  }}
                >
                  Country
                </button>
                <button
                  type="button"
                  aria-pressed={trendMode === "equipment"}
                  className={trendMode === "equipment" ? "active" : ""}
                  onClick={() => setTrendMode("equipment")}
                >
                  Equipment
                </button>
              </div>
              {(settings.scope === "country" || trendMode === "equipment") && (
                <label className="field compact-field campaign-country-field">
                  <span>Country</span>
                  <select
                    value={countryTag}
                    onChange={(event) => {
                      setEquipmentData(null);
                      setEquipmentError("");
                      setCountryTag(event.target.value);
                    }}
                  >
                    {countries.map((tag) => (
                      <option key={tag} value={tag}>
                        {countryFullName(tag)} ({tag})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {trendMode === "equipment" ? (
                <>
                  <label className="field compact-field campaign-equipment-field">
                    <span>Exact equipment definition</span>
                    <select
                      value={equipmentDefinitionKey}
                      onChange={(event) =>
                        setEquipmentDefinitionKey(event.target.value)
                      }
                      disabled={
                        equipmentLoading || !equipmentData?.definitions.length
                      }
                    >
                      {(equipmentData?.definitions ?? []).map(
                        ({ equipmentDefinition }) => (
                          <option
                            key={equipmentDefinition}
                            value={equipmentDefinition}
                          >
                            {formatEquipmentDefinition(equipmentDefinition)} ·{" "}
                            {equipmentDefinition}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label className="field compact-field campaign-equipment-metric-field">
                    <span>Equipment metric</span>
                    <select
                      value={equipmentMetric}
                      onChange={(event) =>
                        setEquipmentMetric(
                          event.target.value as EquipmentTrendMetric,
                        )
                      }
                    >
                      {Object.entries(EQUIPMENT_METRICS).map(
                        ([key, definition]) => (
                          <option key={key} value={key}>
                            {definition.label}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                </>
              ) : (
                <details className="campaign-control-menu">
                  <summary>Metrics · {effectiveMetrics.length}</summary>
                  <div className="campaign-metric-menu">
                    {supported.map((metric) => (
                      <label key={metric.key}>
                        <input
                          type="checkbox"
                          checked={effectiveMetrics.includes(metric.key)}
                          onChange={(event) => {
                            const metrics = event.target.checked
                              ? [...effectiveMetrics, metric.key]
                              : effectiveMetrics.filter(
                                  (key) => key !== metric.key,
                                );
                            if (!metrics.length) return;
                            updateSettings({ metrics, preset: "Custom" });
                          }}
                        />
                        <span>{metric.label}</span>
                      </label>
                    ))}
                  </div>
                </details>
              )}
              <label className="field compact-field">
                <span>X-axis</span>
                <select
                  value={settings.xMode}
                  onChange={(event) =>
                    updateSettings({ xMode: event.target.value as XMode })
                  }
                >
                  <option value="game_date">Game date</option>
                  <option value="sequence">Save sequence</option>
                </select>
              </label>
              {trendMode === "overview" && (
                <label
                  className="campaign-toggle"
                  title="Compare relative change on a 0–1 scale; tooltips retain original snapshot values."
                >
                  <input
                    type="checkbox"
                    checked={settings.normalize}
                    onChange={(event) =>
                      updateSettings({ normalize: event.target.checked })
                    }
                  />
                  <span>Normalize</span>
                </label>
              )}
              <label className="field compact-field">
                <span>Moving average</span>
                <select
                  value={settings.movingAverage}
                  onChange={(event) =>
                    updateSettings({
                      movingAverage: Number(event.target.value) as
                        1 | 3 | 5 | 10,
                    })
                  }
                >
                  <option value={1}>Off</option>
                  <option value={3}>3 saves</option>
                  <option value={5}>5 saves</option>
                  <option value={10}>10 saves</option>
                </select>
              </label>
              <details className="campaign-control-menu campaign-options">
                <summary>Options</summary>
                <div className="campaign-metric-menu">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.onePerGameDate}
                      onChange={(event) =>
                        updateSettings({ onePerGameDate: event.target.checked })
                      }
                    />
                    <span>One snapshot per game date</span>
                  </label>
                  <p>
                    When enabled, the latest analyzed snapshot for each game
                    date wins.
                  </p>
                  {trendMode === "overview" && (
                    <label
                      title={
                        effectiveMetrics.length > 3
                          ? "Select at most three metrics for separate scales."
                          : undefined
                      }
                    >
                      <input
                        type="checkbox"
                        checked={settings.separateScale}
                        disabled={
                          settings.normalize || effectiveMetrics.length > 3
                        }
                        onChange={(event) =>
                          updateSettings({
                            separateScale: event.target.checked,
                          })
                        }
                      />
                      <span>Separate Y scales</span>
                    </label>
                  )}
                </div>
              </details>
            </div>

            <div className="campaign-chart-heading">
              <div>
                <span className="eyebrow">Historical snapshots</span>
                <h2>
                  {trendMode === "equipment"
                    ? selectedEquipmentDefinition
                      ? `${formatEquipmentDefinition(selectedEquipmentDefinition.equipmentDefinition)} · ${countryFullName(countryTag)}`
                      : countryTag
                        ? `Equipment · ${countryFullName(countryTag)}`
                        : "Equipment trends"
                    : settings.scope === "country"
                      ? `${countryFullName(countryTag)} trends`
                      : "Campaign development"}
                </h2>
              </div>
              <p>
                {snapshots.length} snapshots ·{" "}
                {trendMode === "equipment"
                  ? "1 metric"
                  : `${effectiveMetrics.length} metrics`}
              </p>
            </div>
            {trendMode === "overview" && settings.normalize && (
              <p className="campaign-context-note">
                Normalized values compare relative change from each metric’s
                observed minimum to maximum. Tooltips retain original values.
              </p>
            )}
            {settings.movingAverage > 1 && (
              <p className="campaign-context-note">
                Moving average uses ordered, contiguous save snapshots and does
                not bridge unavailable values.
              </p>
            )}
            {trendMode === "equipment" && (
              <p className="campaign-context-note">
                Exact equipment definitions are matched across saves by country
                tag and definition. Stockpile values are signed balances;
                normalization is unavailable in this mode.
              </p>
            )}
            {incompleteRateCount > 0 && (
              <p className="campaign-context-note">
                {incompleteRateCount} production-rate snapshot
                {incompleteRateCount === 1 ? " is" : "s are"} incomplete and
                remains a gap rather than a partial total.
              </p>
            )}
            {missingValues && (
              <p className="campaign-context-note">
                {trendMode === "equipment"
                  ? "Some selected values are unavailable. Missing definitions, countries, or incomplete values remain gaps, not zeroes."
                  : "Some selected values are unavailable. Missing country snapshots remain gaps, not zeroes."}
              </p>
            )}

            {trendMode === "equipment" && !countryTag ? (
              <div className="campaign-state single-save" role="status">
                <h3>No country available</h3>
                <p>No country snapshot data is available for this campaign.</p>
              </div>
            ) : trendMode === "equipment" && equipmentLoading ? (
              <div className="campaign-state single-save" role="status">
                <h3>Loading equipment trends…</h3>
                <p>Reading compact equipment snapshots for this country.</p>
              </div>
            ) : trendMode === "equipment" && equipmentError ? (
              <div className="campaign-state single-save" role="alert">
                <h3>Equipment trends unavailable</h3>
                <p>{equipmentError}</p>
                <button
                  className="button button-secondary"
                  onClick={() => {
                    equipmentCache.current.delete(
                      `${campaign.key}\u0000${countryTag}`,
                    );
                    setEquipmentRevision((current) => current + 1);
                  }}
                >
                  Try again
                </button>
              </div>
            ) : trendMode === "equipment" &&
              equipmentData &&
              equipmentData.definitions.length === 0 ? (
              <div className="campaign-state single-save" role="status">
                <h3>No equipment definitions found</h3>
                <p>
                  This country has no stockpile or current land/air production
                  definitions in the available campaign snapshots.
                </p>
              </div>
            ) : campaign.snapshotCount === 1 ? (
              <div className="campaign-state single-save" role="status">
                <h3>One campaign snapshot available</h3>
                <p>
                  Analyze at least one more save from this campaign to reveal a
                  trend.
                </p>
                {latest && (
                  <dl>
                    {trendMode === "equipment" ? (
                      <div>
                        <dt>{EQUIPMENT_METRICS[equipmentMetric].label}</dt>
                        <dd>{formatValue(equipmentValues.at(-1))}</dd>
                      </div>
                    ) : (
                      effectiveMetrics.slice(0, 4).map((metric) => (
                        <div key={metric}>
                          <dt>{metricDefinition(metric).label}</dt>
                          <dd>
                            {formatValue(
                              metricValue(
                                latest,
                                settings.scope,
                                countryTag,
                                metric,
                              ),
                            )}
                          </dd>
                        </div>
                      ))
                    )}
                  </dl>
                )}
              </div>
            ) : (
              <div
                className="campaign-chart"
                role="img"
                aria-label={chartSummary}
              >
                <Suspense
                  fallback={
                    <div className="campaign-chart-loading">Loading chart…</div>
                  }
                >
                  <Plot
                    data={traces}
                    layout={layout}
                    config={{
                      responsive: true,
                      displaylogo: false,
                      modeBarButtonsToRemove: ["lasso2d", "select2d"],
                    }}
                    useResizeHandler
                    style={{ width: "100%", height: "500px" }}
                  />
                </Suspense>
              </div>
            )}
          </section>

          <section
            className="panel campaign-timeline"
            aria-label="Campaign timeline"
          >
            <div className="campaign-section-heading">
              <div>
                <span className="eyebrow">Campaign timeline</span>
                <h2>Save History</h2>
              </div>
              <p>{snapshots.length} visible snapshots</p>
            </div>
            <div className="table-wrap campaign-timeline-scroll">
              <table className="recent-table">
                <thead>
                  <tr>
                    <th>Game date</th>
                    <th>Save</th>
                    <th>Analyzed</th>
                    {trendMode === "equipment" ? (
                      <th className="num">
                        {EQUIPMENT_METRICS[equipmentMetric].shortLabel}
                      </th>
                    ) : (
                      timelineMetrics.map((metric) => (
                        <th className="num" key={metric}>
                          {metricDefinition(metric).shortLabel}
                        </th>
                      ))
                    )}
                    <th>Context</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((snapshot, snapshotIndex) => {
                    const selected = snapshot.hash === selectedHash;
                    const sameDateCount =
                      duplicateDates.get(snapshot.gameDate) ?? 1;
                    return (
                      <tr
                        key={snapshot.hash}
                        tabIndex={0}
                        aria-selected={selected}
                        onClick={() => setSelectedHash(snapshot.hash)}
                        onKeyDown={(event) =>
                          activateRow(event, () =>
                            setSelectedHash(snapshot.hash),
                          )
                        }
                      >
                        <td>{snapshot.gameDate}</td>
                        <td>
                          <strong>{snapshot.fileName}</strong>
                          <small>{snapshot.hash.slice(0, 8)}</small>
                        </td>
                        <td>
                          <time dateTime={snapshot.analyzedAt}>
                            {DATE_TIME.format(new Date(snapshot.analyzedAt))}
                          </time>
                        </td>
                        {trendMode === "equipment" ? (
                          <td className="num">
                            {formatValue(equipmentValues[snapshotIndex])}
                          </td>
                        ) : (
                          timelineMetrics.map((metric) => (
                            <td className="num" key={metric}>
                              {formatValue(
                                metricValue(
                                  snapshot,
                                  settings.scope,
                                  countryTag,
                                  metric,
                                ),
                              )}
                            </td>
                          ))
                        )}
                        <td>
                          {selected ? (
                            <span className="timeline-status selected">
                              Selected
                            </span>
                          ) : sameDateCount > 1 ? (
                            <span className="timeline-status">
                              Same date · {sameDateCount}
                            </span>
                          ) : (
                            <span className="timeline-status muted">
                              Snapshot
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {telemetry.length > 0 && (
        <details className="panel campaign-telemetry">
          <summary>
            <span>
              <span className="eyebrow">Technical telemetry</span>
              <strong>Autosave Performance</strong>
            </span>
            <small>{telemetry.length} tracker records</small>
          </summary>
          <p className="campaign-context-note">
            Host telemetry from the autosave tracker. It is not joined to
            analyzed campaign snapshots.
          </p>
          <div className="telemetry-summary">
            <div>
              <span>Avg write time</span>
              <strong>
                {formatValue(
                  average(
                    telemetry.map((record) => record.write_duration_seconds),
                  ),
                )}{" "}
                s
              </strong>
            </div>
            <div>
              <span>Avg CPU</span>
              <strong>
                {formatValue(
                  average(telemetry.map((record) => record.cpu_avg)),
                )}
                %
              </strong>
            </div>
            <div>
              <span>Avg RAM</span>
              <strong>
                {formatValue(
                  average(telemetry.map((record) => record.ram_avg)),
                )}{" "}
                MB
              </strong>
            </div>
            <div>
              <span>Latest tracker date</span>
              <strong>{telemetry.at(-1)?.game_date ?? "—"}</strong>
            </div>
          </div>
        </details>
      )}
      {!telemetry.length && telemetryError && (
        <p className="campaign-message muted" role="status">
          Autosave performance telemetry is unavailable. Campaign trends remain
          usable.
        </p>
      )}
    </main>
  );
}
