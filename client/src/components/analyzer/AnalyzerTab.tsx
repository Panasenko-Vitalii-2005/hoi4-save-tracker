import React, {
  Suspense,
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
} from "react";
import type { AnalyzeResult, CountryStats, RecentAnalysis } from "@/types";
import { apiFetch } from "@/lib/api-client";
import { SummaryGrid } from "@/components/ui/SummaryGrid";
import {
  countryFullName,
  fmtBig,
  formatCountryDisplayName,
  resolvePreferredCountryTag,
  shortEqName,
} from "@/lib/utils";
import { usePlotTheme } from "@/hooks/usePlotTheme";
import { WarCasualtiesTab } from "./WarCasualtiesTab";
import { NavalLossesTab } from "./NavalLossesTab";
import { ProductionTab } from "./ProductionTab";
import { StockpileTab } from "./StockpileTab";
import { LandForcesTab } from "./LandForcesTab";
import { CountryDisplay } from "./CountryDisplay";
import { RecentAnalyses, type RecentComparisonState } from "./RecentAnalyses";
import { AnalysisComparison } from "./AnalysisComparison";
import {
  BatchAnalysisPanel,
  type BatchAnalysisPanelHandle,
} from "./BatchAnalysisPanel";
import {
  analyzerUnavailableMessage,
  analysisError,
  analysisFileReadError,
  analysisNetworkError,
  type AnalysisFailure,
} from "@/lib/analysis-error";
import { isAnalyzeResult } from "@/lib/analyze-result";
import { ExportControls } from "@/components/ui/ExportControls";
import {
  buildSingleSaveExport,
  prettyJson,
  singleSaveCsv,
  singleSaveExportFilename,
} from "@/lib/data-export";
import {
  SingleSaveReport,
  type SingleSaveReportContext,
} from "@/components/reports/SingleSaveReport";
import { BinarySaveRecovery } from "./BinarySaveRecovery";
import {
  trackAnalysisEvent,
  type AnalysisSection,
} from "@/lib/product-telemetry";
import { useAppTranslation } from "@/i18n";

const Plot = React.lazy(() => import("react-plotly.js"));

interface SaveFile {
  name: string;
  path: string;
  size_mb: number;
  modified: string;
}
function probeUploadFile(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve();
    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(new DOMException("File read aborted"));
    try {
      reader.readAsArrayBuffer(file.slice(0, 1));
    } catch (error) {
      reject(error);
    }
  });
}

function isSaveBrowserData(
  value: unknown,
): value is { dir: string; exists: boolean; files: SaveFile[] } {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.dir === "string" &&
    typeof data.exists === "boolean" &&
    Array.isArray(data.files) &&
    data.files.every(
      (file) =>
        !!file &&
        typeof file === "object" &&
        typeof (file as Record<string, unknown>).name === "string" &&
        typeof (file as Record<string, unknown>).path === "string" &&
        typeof (file as Record<string, unknown>).size_mb === "number" &&
        typeof (file as Record<string, unknown>).modified === "string",
    )
  );
}
type SortCol = keyof CountryStats;
type AnalysisView = AnalysisSection;

const ANALYZER_VIEW_KEY: Record<AnalysisView, string> = {
  overview: "overview",
  "war-casualties": "warCasualties",
  "naval-losses": "navalLosses",
  stockpile: "stockpile",
  production: "production",
  "land-forces": "landForces",
};

function AnalyzerViewContext({
  view,
  gameDate,
  actions,
  sectionRef,
}: {
  view: AnalysisView;
  gameDate: string;
  actions?: React.ReactNode;
  sectionRef?: React.Ref<HTMLElement>;
}) {
  const { t } = useAppTranslation();
  const key = ANALYZER_VIEW_KEY[view];
  return (
    <section className="analyzer-view-context" ref={sectionRef}>
      <div>
        <span>{t(`analysis.views.${key}.eyebrow`)}</span>
        <h2>{t(`analysis.views.${key}.title`)}</h2>
        <p>{t(`analysis.views.${key}.description`)}</p>
      </div>
      <div className="analyzer-view-side">
        <div className="analyzer-view-date">
          <span>{t("analysis.context.saveDate")}</span>
          <strong>{gameDate}</strong>
        </div>
        {actions}
      </div>
    </section>
  );
}

function SaveBrowser({
  onSelect,
  onUpload,
  onBatchUpload,
  analyzing,
}: {
  onSelect: (p: string, n: string) => void;
  onUpload: (file: File) => void;
  onBatchUpload: () => void;
  analyzing: boolean;
}) {
  const { t } = useAppTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dir, setDir] = useState("");
  const [files, setFiles] = useState<SaveFile[]>([]);
  const [page, setPage] = useState(1);
  const [exists, setExists] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const PAGE_SIZE = 10;

  const loadDir = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    let reachedService = false;
    try {
      const response = await apiFetch("/api/saves");
      reachedService = true;
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok || !isSaveBrowserData(data))
        throw new Error("Local saves unavailable");
      setDir(data.dir);
      setExists(data.exists);
      setFiles([...data.files].reverse());
      setPage(1);
    } catch {
      setLoadError(
        reachedService
          ? t("analysis.localLoadFailed")
          : analyzerUnavailableMessage(),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadDir();
  }, [loadDir]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  };

  return (
    <section
      id="analyze-one-save"
      className="panel analyzer-save-browser"
      aria-busy={analyzing}
    >
      <div className="panel-head analyzer-save-browser-head">
        <div className="analyzer-save-browser-copy">
          <span className="batch-analysis-eyebrow">{t("analysis.singleEyebrow")}</span>
          <h2>{t("analysis.singleTitle")}</h2>
          <p>{t("analysis.singleBody")}</p>
        </div>
        <button
          className="button button-primary analyzer-save-action"
          disabled={analyzing}
          onClick={() => fileInput.current?.click()}
        >
          {t("analysis.analyzeSave")}
        </button>
        <button
          className="button button-secondary analyzer-save-action"
          disabled={analyzing}
          onClick={onBatchUpload}
        >
          {t("analysis.importCampaign")}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".hoi4"
          aria-label={t("analysis.uploadAria")}
          disabled={analyzing}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file && !analyzing) onUpload(file);
            event.target.value = "";
          }}
        />
        <button
          className="button button-secondary analyzer-save-action"
          onClick={loadDir}
          disabled={loading}
        >
          ↻ {t("analysis.refresh")}
        </button>
      </div>
      <div className="analyzer-save-directory">
        <div className="analyzer-save-directory-label">
          {t("analysis.localDirectory")}
        </div>
        <div className="analyzer-save-directory-path">
          {dir || "…"}
        </div>
      </div>
      {loadError && (
        <div className="recovery-notice" role="alert">
          <span>{loadError}</span>
          <button
            className="button button-secondary"
            onClick={() => void loadDir()}
            disabled={loading}
          >
            {t("common.retry")}
          </button>
        </div>
      )}
      {loading && files.length === 0 ? (
        <div className="micro-copy" style={{ padding: "16px 0" }}>
          {t("analysis.scanning")}
        </div>
      ) : !loadError && !exists ? (
        <div className="micro-copy" style={{ padding: "16px 0" }}>
          {t("analysis.localDirectoryUnavailable")}
        </div>
      ) : !loadError && files.length === 0 ? (
        <div className="micro-copy" style={{ padding: "16px 0" }}>
          {t("analysis.noLocalFiles")}
        </div>
      ) : files.length > 0 ? (
        <>
          <div className="panel-head analyzer-save-pagination">
            <div />
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="micro-copy">
                {t("analysis.page", { page, total: Math.max(1, Math.ceil(files.length / PAGE_SIZE)) })}
              </span>
              <button
                className="button button-secondary"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page === 1}
                style={{ padding: "6px 12px" }}
              >
                ← {t("analysis.previous")}
              </button>
              <button
                className="button button-secondary"
                onClick={() =>
                  setPage((prev) =>
                    Math.min(
                      Math.max(1, Math.ceil(files.length / PAGE_SIZE)),
                      prev + 1,
                    ),
                  )
                }
                disabled={page >= Math.ceil(files.length / PAGE_SIZE)}
                style={{ padding: "6px 12px" }}
              >
                {t("analysis.next")} →
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="recent-table">
              <thead>
                <tr>
                  <th>{t("analysis.saveFile")}</th>
                  <th style={{ textAlign: "right" }}>{t("analysis.size")}</th>
                  <th style={{ textAlign: "right" }}>{t("analysis.lastModified")}</th>
                </tr>
              </thead>
              <tbody>
                {files
                  .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
                  .map((f) => (
                    <tr
                      key={f.path}
                      className="analyzer-save-row"
                      onClick={() => {
                        if (!analyzing) onSelect(f.path, f.name);
                      }}
                      tabIndex={analyzing ? -1 : 0}
                      aria-disabled={analyzing}
                      aria-label={t("analysis.analyzeFile", { name: f.name })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          if (!analyzing) onSelect(f.path, f.name);
                        }
                      }}
                    >
                      <td>
                        <span
                          style={{
                            fontFamily: '"IBM Plex Mono",monospace',
                            fontSize: 13,
                          }}
                        >
                          {f.name}
                        </span>
                      </td>
                      <td className="numeric-cell analyzer-save-meta">
                        {f.size_mb} MB
                      </td>
                      <td className="numeric-cell analyzer-save-meta">
                        {fmt(f.modified)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

export function AnalyzerTab({
  readOnlyResult,
  onNavigateToCampaignTrends,
  focusRequest,
}: {
  readOnlyResult?: AnalyzeResult;
  onNavigateToCampaignTrends?: () => void;
  focusRequest?: {
    target: "analyze" | "import";
    request: number;
  } | null;
} = {}) {
  const { t } = useAppTranslation();
  const readOnly = readOnlyResult !== undefined;
  const BASE = usePlotTheme();
  const [status, setStatus] = useState<{
    type: "idle" | "loading" | "ok" | "error" | "busy";
    msg: string;
    recovery?: AnalysisFailure["recovery"];
    reason?: AnalysisFailure["reason"];
  }>({ type: "idle", msg: "" });
  const analysisInFlight = useRef(false);
  const lastAnalysis = useRef<{
    filePath: string;
    fileName: string;
    uploadedFile?: File;
  } | null>(null);
  const resultRequestVersion = useRef(0);
  const openingRequest = useRef<AbortController | null>(null);
  const [openingHash, setOpeningHash] = useState<string | null>(null);
  const [openError, setOpenError] = useState("");
  const [historyVersion, setHistoryVersion] = useState(0);
  const [comparisonState, setComparisonState] =
    useState<RecentComparisonState | null>(null);
  const onComparisonStateChange = useCallback(
    (next: RecentComparisonState) => setComparisonState(next),
    [],
  );
  const overviewStartRef = useRef<HTMLElement>(null);
  const [openScrollRequest, setOpenScrollRequest] = useState(0);
  const lastScrolledOpenRequest = useRef(0);
  const [batchRunning, setBatchRunning] = useState(false);
  const batchPanelRef = useRef<BatchAnalysisPanelHandle>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(
    readOnlyResult ?? null,
  );
  const [resultSource, setResultSource] = useState<SingleSaveReportContext>({
    fileName: null,
    analysisHash: null,
    playerCountryTag: null,
  });
  const [reportOpen, setReportOpen] = useState(false);
  const [prevResult, setPrevResult] = useState<AnalyzeResult | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>("manpowerInField");
  const [sortAsc, setSortAsc] = useState(false);
  const [filter, setFilter] = useState("");
  const [showEq, setShowEq] = useState(false);
  const [eqCountry, setEqCountry] = useState("");
  const [navalLossCountryTag, setNavalLossCountryTag] = useState<
    string | null | undefined
  >(undefined);
  const [navalKillCountryTag, setNavalKillCountryTag] = useState<
    string | undefined
  >(undefined);
  const [analysisView, setAnalysisView] =
    useState<AnalysisView>("overview");
  const [productionCountryTag, setProductionCountryTag] = useState<
    string | null
  >(null);
  const [productionDefinitionName, setProductionDefinitionName] = useState<
    string | null
  >(null);
  const [landForcesCountryTag, setLandForcesCountryTag] = useState<
    string | null
  >(null);
  const [landForcesDivisionKey, setLandForcesDivisionKey] = useState<
    string | null
  >(null);

  useEffect(() => {
    const hash = resultSource.analysisHash;
    if (readOnly || !result || !hash) return;
    void trackAnalysisEvent("analysis_opened", hash);
  }, [readOnly, result, resultSource.analysisHash]);

  useEffect(() => {
    const hash = resultSource.analysisHash;
    if (readOnly || !result || !hash) return;
    void trackAnalysisEvent(
      "analysis_section_viewed",
      hash,
      analysisView,
    );
  }, [analysisView, readOnly, result, resultSource.analysisHash]);

  useEffect(() => {
    if (!focusRequest || readOnly) return;
    const section = document.getElementById(
      focusRequest.target === "import"
        ? "import-campaign"
        : "analyze-one-save",
    );
    section?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    section?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [focusRequest, readOnly]);

  useEffect(() => {
    if (
      !openScrollRequest ||
      openScrollRequest === lastScrolledOpenRequest.current ||
      !result ||
      analysisView !== "overview"
    ) return;
    lastScrolledOpenRequest.current = openScrollRequest;
    overviewStartRef.current?.scrollIntoView?.({
      behavior: "smooth",
      block: "start",
    });
  }, [openScrollRequest, result, analysisView]);

  useEffect(
    () => () => {
      resultRequestVersion.current++;
      openingRequest.current?.abort();
      openingRequest.current = null;
    },
    [],
  );

  const applyResult = (
    data: AnalyzeResult,
    source: SingleSaveReportContext,
  ) => {
    const initialEqCountry =
      resolvePreferredCountryTag(
        Object.keys(data.equipment_by_country).sort(),
        source.playerCountryTag,
      ) ??
      data.by_country[0]?.tag ??
      "";
    setPrevResult(result);
    setResult(data);
    setResultSource(source);
    setReportOpen(false);
    setAnalysisView("overview");
    setEqCountry(initialEqCountry);
    setProductionCountryTag(
      resolvePreferredCountryTag(
        data.militaryProductionSummaries.map(({ countryTag }) => countryTag),
        source.playerCountryTag,
      ),
    );
    setProductionDefinitionName(null);
    setLandForcesCountryTag(
      resolvePreferredCountryTag(
        data.divisionSummaries.map(({ countryTag }) => countryTag),
        source.playerCountryTag,
      ),
    );
    setLandForcesDivisionKey(null);
    setShowEq(true);
  };

  const openResult = async (item: RecentAnalysis) => {
    // Separate from the upload lock; a newer analysis can supersede this read.
    if (openingRequest.current || analysisInFlight.current) return;
    const controller = new AbortController();
    openingRequest.current = controller;
    const version = ++resultRequestVersion.current;
    setOpeningHash(item.hash);
    setOpenError("");
    try {
      const response = await apiFetch(
        `/api/analyze/recent/${encodeURIComponent(item.hash)}/result`,
        { signal: controller.signal },
      );
      if (version !== resultRequestVersion.current) return;
      if (response.status === 404 || response.status === 410) {
        setOpenError(
          "The saved analysis result is no longer available. The original .hoi4 file was not stored; analyze it again to recreate the result.",
        );
        setHistoryVersion((value) => value + 1);
        return;
      }
      if (!response.ok) {
        setOpenError(
          "Could not open the saved analysis. Your currently displayed result is unchanged. Try again.",
        );
        return;
      }
      const data: unknown = await response.json().catch(() => null);
      if (version !== resultRequestVersion.current) return;
      if (!isAnalyzeResult(data)) {
        setOpenError(
          "Could not open the saved analysis because its stored result cannot be read. The original .hoi4 file was not stored; analyze it again to recreate the result.",
        );
        return;
      }
      applyResult(data, {
        fileName: item.fileName,
        analysisHash: item.hash,
        playerCountryTag: item.playerCountryTag ?? null,
      });
      setOpenScrollRequest((value) => value + 1);
      setStatus({
        type: "ok",
        msg: `✓ Opened analysis: ${item.fileName} — ${data.game_date} · Original parse: ${data.parse_seconds}s`,
      });
    } catch {
      if (version === resultRequestVersion.current)
        setOpenError(
          "Could not open the saved analysis. Cannot reach the analyzer service. Your currently displayed result is unchanged; check that the application is running and try again.",
        );
    } finally {
      if (openingRequest.current === controller) {
        openingRequest.current = null;
        setOpeningHash(null);
      }
    }
  };

  const analyze = async (
    filePath: string,
    fileName: string,
    uploadedFile?: File,
  ) => {
    // Guard synchronously: multiple events can arrive before React rerenders.
    if (analysisInFlight.current || batchRunning) return;
    analysisInFlight.current = true;
    lastAnalysis.current = { filePath, fileName, uploadedFile };
    resultRequestVersion.current++;
    openingRequest.current?.abort();
    openingRequest.current = null;
    setOpeningHash(null);
    setOpenError("");
    setStatus({
      type: "loading",
      msg: `${t(uploadedFile ? "analysis.uploading" : "analysis.analyzing", { name: fileName })}${result ? t("analysis.previousSafe") : ""}`,
    });
    try {
      if (uploadedFile) {
        try {
          // Force a bounded read before fetch so a stale/unavailable browser
          // File is not misreported as an analyzer-service outage.
          await probeUploadFile(uploadedFile);
        } catch {
          lastAnalysis.current = null;
          setStatus(analysisFileReadError());
          return;
        }
      }
      const formData = new FormData();
      if (uploadedFile) formData.append("file", uploadedFile);
      const resp = await apiFetch(
        "/api/analyze",
        uploadedFile
          ? { method: "POST", body: formData }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path: filePath }),
            },
      );
      if (!resp.ok) {
        const failure = await analysisError(resp);
        if (failure.recovery === "choose-file") lastAnalysis.current = null;
        setStatus(failure);
        return;
      }
      const data: unknown = await resp.json().catch(() => null);
      if (!isAnalyzeResult(data)) {
        setStatus({
          type: "error",
          msg: t("analysis.responseUnreadable"),
          recovery: "retry",
        });
        return;
      }
      const responseHash = resp.headers.get("X-Analysis-Hash");
      applyResult(data, {
        fileName,
        analysisHash:
          responseHash && /^[0-9a-f]{64}$/i.test(responseHash)
            ? responseHash.toLowerCase()
            : null,
        playerCountryTag: null,
      });
      lastAnalysis.current = null;
      setHistoryVersion((value) => value + 1);
      setStatus({
        type: "ok",
        msg: `✓ ${fileName}  —  ${data.parse_seconds}s · ${data.file_size_mb} MB · ${data.game_date}`,
      });
    } catch {
      setStatus(analysisNetworkError());
    } finally {
      analysisInFlight.current = false;
    }
  };

  const sortedRows = useMemo(() => {
    if (!result) return [];
    const filterUpper = filter.toUpperCase();
    return [
      ...result.by_country.filter(
        (r) =>
          !filter ||
          r.tag.toUpperCase().includes(filterUpper) ||
          countryFullName(r.tag).toUpperCase().includes(filterUpper),
      ),
    ].sort((a, b) => {
      const va = a[sortCol] ?? 0,
        vb = b[sortCol] ?? 0;
      if (sortCol === "tag") {
        const na = countryFullName(String(a.tag));
        const nb = countryFullName(String(b.tag));
        return sortAsc ? na.localeCompare(nb) : nb.localeCompare(na);
      }
      if (typeof va === "string")
        return sortAsc
          ? va.localeCompare(String(vb))
          : String(vb).localeCompare(va);
      return sortAsc
        ? (va as number) - (vb as number)
        : (vb as number) - (va as number);
    });
  }, [result, sortCol, sortAsc, filter]);

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortAsc((p) => !p);
    else {
      setSortCol(col);
      setSortAsc(col === "tag");
    }
  };

  // Derived views — computed from CountryStats[], no duplication
  const mpRows = useMemo(
    () =>
      result?.by_country.filter((r) => r.manpowerInField > 0).slice(0, 30) ??
      [],
    [result],
  );
  const navyAirRows = useMemo(
    () =>
      [...(result?.by_country ?? [])]
        .filter((r) => r.ships > 0 || r.aircraft > 0)
        .sort((a, b) => b.ships + b.aircraft - (a.ships + a.aircraft))
        .slice(0, 25),
    [result],
  );
  const industryRows = useMemo(
    () =>
      [...(result?.by_country ?? [])]
        .filter(
          (r) =>
            r.effectiveMilitaryFactories > 0 ||
            r.effectiveCivilianFactories > 0 ||
            r.effectiveDockyards > 0,
        )
        .sort(
          (a, b) =>
            b.effectiveMilitaryFactories +
            b.effectiveCivilianFactories -
            (a.effectiveMilitaryFactories + a.effectiveCivilianFactories),
        )
        .slice(0, 25),
    [result],
  );
  const industryLabels = useMemo(
    () => [...industryRows].reverse().map((r) => countryFullName(r.tag)),
    [industryRows],
  );
  const industryY = useMemo(
    () => industryLabels.map((_, idx) => idx),
    [industryLabels],
  );

  const topIndustry = useMemo(() => industryRows.slice(0, 10), [industryRows]);
  const topNavy = useMemo(
    () =>
      [...(result?.by_country ?? [])]
        .filter((r) => r.ships > 0)
        .sort((a, b) => b.ships - a.ships)
        .slice(0, 10),
    [result],
  );
  const topAir = useMemo(
    () =>
      [...(result?.by_country ?? [])]
        .filter((r) => r.aircraft > 0)
        .sort((a, b) => b.aircraft - a.aircraft)
        .slice(0, 10),
    [result],
  );
  const topMobilization = useMemo(
    () =>
      [...(result?.by_country ?? [])]
        .filter((r) => r.manpowerInField > 0)
        .sort((a, b) => b.manpowerInField - a.manpowerInField)
        .slice(0, 10),
    [result],
  );
  const equipmentTotalsByCountry = useMemo(() => {
    if (!result) return [] as [string, number][];
    return Object.entries(result.equipment_by_country)
      .map(
        ([tag, equipment]) =>
          [
            tag,
            Object.values(equipment).reduce((sum, value) => sum + value, 0),
          ] as [string, number],
      )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }, [result]);
  const topEquipmentLabels = useMemo(
    () => equipmentTotalsByCountry.map(([tag]) => countryFullName(tag)),
    [equipmentTotalsByCountry],
  );
  const topEquipmentValues = useMemo(
    () => equipmentTotalsByCountry.map(([, value]) => value),
    [equipmentTotalsByCountry],
  );

  // world_equipment is available on `result.totals` if needed later

  const prevTotals = prevResult?.totals;
  const diffTotals = useMemo(() => {
    if (!result || !prevTotals) return null;
    return {
      industry:
        result.totals.effectiveMilitaryFactories +
        result.totals.effectiveCivilianFactories +
        result.totals.effectiveDockyards -
        (prevTotals.effectiveMilitaryFactories +
          prevTotals.effectiveCivilianFactories +
          prevTotals.effectiveDockyards),
      ships: result.totals.ships - prevTotals.ships,
      aircraft: result.totals.aircraft - prevTotals.aircraft,
      manpowerInField:
        result.totals.manpowerInField - prevTotals.manpowerInField,
    };
  }, [result, prevTotals]);

  const renderDelta = (value: number) =>
    `${value >= 0 ? "+" : ""}${value.toLocaleString()}`;

  const summaryCards = useMemo(() => {
    if (!result) return [];
    const cards = [
      {
        label: t("analysis.overview.gameDate"),
        value: result.game_date,
        sub: t("analysis.overview.fileSize", { size: result.file_size_mb }),
      },
      {
        label: t("analysis.overview.activeCountries"),
        value: result.active_countries,
        sub: t("analysis.overview.statesOwned"),
      },
      {
        label: t("analysis.overview.totalManpower"),
        value: fmtBig(result.totals.manpowerInField),
        sub: t("analysis.overview.divisionsCount", { count: result.totals.divisions.toLocaleString() }),
      },
      {
        label: t("analysis.overview.warIndustryCard"),
        value: result.totals.effectiveMilitaryFactories.toLocaleString(),
        sub: t("analysis.overview.industrySummary", { mil: result.totals.effectiveMilitaryFactories, civ: result.totals.effectiveCivilianFactories, dockyards: result.totals.effectiveDockyards }),
      },
    ];
    if (diffTotals) {
      cards.push(
        {
          label: "Industry Δ",
          value: renderDelta(diffTotals.industry),
          sub: "vs previous save",
        },
        {
          label: `${t("analysis.overview.ships")} Δ`,
          value: renderDelta(diffTotals.ships),
          sub: "vs previous save",
        },
        {
          label: `${t("analysis.overview.aircraft")} Δ`,
          value: renderDelta(diffTotals.aircraft),
          sub: "vs previous save",
        },
        {
          label: `${t("analysis.overview.manpowerMetric")} Δ`,
          value: renderDelta(diffTotals.manpowerInField),
          sub: "vs previous save",
        },
      );
    }
    return cards;
  }, [result, diffTotals, t]);

  const eqCountries = useMemo(
    () =>
      Object.keys(result?.equipment_by_country ?? {}).sort((a, b) =>
        countryFullName(a).localeCompare(countryFullName(b)),
      ),
    [result],
  );
  const selectedEqCountry = useMemo(
    () =>
      eqCountry && eqCountries.includes(eqCountry)
        ? eqCountry
        : eqCountries[0] || "",
    [eqCountry, eqCountries],
  );

  const selectedProductionEffectiveMilitaryFactories = useMemo(
    () =>
      result?.by_country.find(
        ({ tag }) => tag === productionCountryTag,
      )?.effectiveMilitaryFactories ?? null,
    [productionCountryTag, result],
  );

  useEffect(() => {
    if (result && eqCountries.length > 0 && !eqCountry) {
      setEqCountry(eqCountries[0]);
    } else if (eqCountry && !eqCountries.includes(eqCountry)) {
      setEqCountry(eqCountries[0] ?? "");
    }
  }, [eqCountry, eqCountries, result]);

  const eqEntries = useMemo(() => {
    if (!selectedEqCountry || !result?.equipment_by_country) return [];
    return Object.entries(result.equipment_by_country[selectedEqCountry] ?? {})
      .map((entry) => [entry[0], entry[1]] as [string, number])
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 35);
  }, [result, selectedEqCountry]);
  const worldEntries = useMemo(
    () => Object.entries(result?.world_equipment ?? {}).slice(0, 20),
    [result],
  );

  const SortTh = ({ col, label }: { col: SortCol; label: string }) => (
    <th
      className={`sortable${sortCol === col ? (sortAsc ? " sort-asc" : " sort-desc") : ""}`}
      onClick={() => handleSort(col)}
      style={{ cursor: "pointer", userSelect: "none" }}
    >
      {label}
    </th>
  );

  // Computed gradient color for manpower bar
  const mpColor = (r: CountryStats) => {
    const t = r.manpowerInField / (mpRows[0]?.manpowerInField || 1);
    return `rgb(${Math.round(11 + 206 * t)},${Math.round(122 - 43 * t)},${Math.round(117 - 74 * t)})`;
  };

  if (result && reportOpen)
    return (
      <div className="analyzer-shell">
        <SingleSaveReport
          result={result}
          context={resultSource}
          onBack={() => setReportOpen(false)}
        />
      </div>
    );

  return (
    <div className="analyzer-shell">
      {!readOnly && (
        <>
          <SaveBrowser
            analyzing={status.type === "loading" || batchRunning}
            onSelect={analyze}
            onUpload={(file) => analyze("", file.name, file)}
            onBatchUpload={() => batchPanelRef.current?.openPicker()}
          />

          <BatchAnalysisPanel
            ref={batchPanelRef}
            disabled={status.type === "loading"}
            onRunningChange={setBatchRunning}
            onHistoryChanged={() => setHistoryVersion((value) => value + 1)}
            onNavigateToCampaignTrends={onNavigateToCampaignTrends}
          />

          <div role="status" aria-live="polite" aria-atomic="true">
            {status.type !== "idle" && (
              <div
                className={`panel analyzer-status ${status.type}${status.reason === "unsupported-binary-save" ? " binary-save-recovery-status" : ""}`}
                style={{ padding: "14px 20px" }}
              >
                {status.reason === "unsupported-binary-save" ? (
                  <BinarySaveRecovery
                    onChooseFile={() =>
                      document
                        .querySelector<HTMLButtonElement>(
                          "#analyze-one-save .button-primary",
                        )
                        ?.click()
                    }
                  />
                ) : (
                  <>
                    {status.type === "loading" && (
                      <span className="spinner" aria-hidden="true" />
                    )}
                    <span>{status.msg}</span>
                    {status.recovery && status.type !== "loading" && (
                      <button
                        className="button button-secondary analyzer-status-action"
                        onClick={() => {
                          if (status.recovery === "choose-file") {
                            document
                              .querySelector<HTMLButtonElement>(
                                "#analyze-one-save .button-primary",
                              )
                              ?.click();
                            return;
                          }
                          const attempt = lastAnalysis.current;
                          if (attempt)
                            void analyze(
                              attempt.filePath,
                              attempt.fileName,
                              attempt.uploadedFile,
                            );
                        }}
                      >
                        {status.recovery === "choose-file"
                          ? t("analysis.chooseAnother")
                          : t("analysis.retryAnalysis")}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <RecentAnalyses
            refreshVersion={historyVersion}
            onOpen={(item) => void openResult(item)}
            openingHash={openingHash}
            openError={openError}
            analyzing={status.type === "loading" || batchRunning}
            onAnalyzeSave={() =>
              document
                .querySelector<HTMLButtonElement>(
                  "#analyze-one-save .button-primary",
                )
                ?.click()
            }
            onImportCampaign={() => batchPanelRef.current?.openPicker()}
            onComparisonStateChange={onComparisonStateChange}
          />
        </>
      )}

      {result && (
        <>
          <div
            className="tab-bar analyzer-view-tabs"
            role="tablist"
            aria-label={t("analysis.viewsLabel")}
          >
            <button
              className={`tab-btn${analysisView === "overview" ? " active" : ""}`}
              onClick={() => setAnalysisView("overview")}
              role="tab"
              aria-selected={analysisView === "overview"}
            >
              {t("analysis.sections.overview")}
            </button>
            <button
              className={`tab-btn${analysisView === "war-casualties" ? " active" : ""}`}
              onClick={() => setAnalysisView("war-casualties")}
              role="tab"
              aria-selected={analysisView === "war-casualties"}
            >
              {t("analysis.sections.warCasualties")}
            </button>
            <button
              className={`tab-btn${analysisView === "naval-losses" ? " active" : ""}`}
              onClick={() => setAnalysisView("naval-losses")}
              role="tab"
              aria-selected={analysisView === "naval-losses"}
            >
              {t("analysis.sections.navalLosses")}
            </button>
            <button
              className={`tab-btn${analysisView === "stockpile" ? " active" : ""}`}
              onClick={() => setAnalysisView("stockpile")}
              role="tab"
              aria-selected={analysisView === "stockpile"}
            >
              {t("analysis.sections.stockpile")}
            </button>
            <button
              className={`tab-btn${analysisView === "production" ? " active" : ""}`}
              onClick={() => setAnalysisView("production")}
              role="tab"
              aria-selected={analysisView === "production"}
            >
              {t("analysis.sections.production")}
            </button>
            <button
              className={`tab-btn${analysisView === "land-forces" ? " active" : ""}`}
              onClick={() => setAnalysisView("land-forces")}
              role="tab"
              aria-selected={analysisView === "land-forces"}
            >
              {t("analysis.sections.landForces")}
            </button>
          </div>

          <AnalyzerViewContext
            view={analysisView}
            gameDate={result.game_date}
            sectionRef={overviewStartRef}
            actions={
              <>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => setReportOpen(true)}
                >
                  {t("analysis.viewReport")}
                </button>
                <ExportControls
                  label={t("analysis.exportCurrent")}
                  createCsv={() => ({
                    content: singleSaveCsv(result, resultSource),
                    filename: singleSaveExportFilename(result.game_date, "csv"),
                  })}
                  createJson={() => ({
                    content: prettyJson(
                      buildSingleSaveExport(result, resultSource),
                    ),
                    filename: singleSaveExportFilename(result.game_date, "json"),
                  })}
                />
              </>
            }
          />

          {analysisView === "war-casualties" ? (
            <WarCasualtiesTab countries={result.by_country} />
          ) : analysisView === "naval-losses" ? (
            <NavalLossesTab
              summaries={result.navalLossSummaries}
              events={result.navalLosses}
              selectedTag={navalLossCountryTag}
              onSelect={setNavalLossCountryTag}
              killSummaries={result.navalKillSummaries}
              killerShips={result.navalKillerShipSummaries}
              selectedKillTag={navalKillCountryTag}
              onSelectKill={setNavalKillCountryTag}
            />
          ) : analysisView === "stockpile" ? (
            <StockpileTab
              summaries={result.stockpileSummaries ?? []}
              preferredCountryTag={resultSource.playerCountryTag}
            />
          ) : analysisView === "production" ? (
            <ProductionTab
              summaries={result.militaryProductionSummaries ?? []}
              selectedTag={productionCountryTag}
              selectedDefinitionName={productionDefinitionName}
              preferredCountryTag={resultSource.playerCountryTag}
              effectiveMilitaryFactories={
                selectedProductionEffectiveMilitaryFactories
              }
              onSelectedTagChange={setProductionCountryTag}
              onSelectedDefinitionChange={setProductionDefinitionName}
            />
          ) : analysisView === "land-forces" ? (
            <LandForcesTab
              summaries={result.divisionSummaries}
              templates={result.divisionTemplateCatalog}
              equipment={result.divisionEquipmentCatalog}
              hierarchies={result.armyHierarchySummaries}
              selectedTag={landForcesCountryTag}
              selectedDivisionKey={landForcesDivisionKey}
              preferredCountryTag={resultSource.playerCountryTag}
              onSelectedTagChange={setLandForcesCountryTag}
              onSelectedDivisionKeyChange={setLandForcesDivisionKey}
            />
          ) : (
            <>
          {/* Summary cards — derived from totals: CountryTotals */}
          <SummaryGrid cards={summaryCards} />

          {/* Manpower + Navy/Air charts */}
          <div className="analyzer-charts-row">
            <section className="panel analyzer-chart-panel" style={{ flex: 2 }}>
              <div className="panel-head">
                <h2>{t("analysis.overview.manpower")}</h2>
                <div className="micro-copy">{t("analysis.overview.topTen")} · {mpRows.length}</div>
              </div>
              <Suspense
                fallback={<div style={{ minHeight: 520 }}>{t("analysis.overview.loading")}</div>}
              >
                <Plot
                  data={[
                    {
                      type: "bar",
                      orientation: "h",
                      x: [...mpRows].reverse().map((r) => r.manpowerInField),
                      y: [...mpRows]
                        .reverse()
                        .map((r) => countryFullName(r.tag)),
                      marker: {
                        color: [...mpRows].reverse().map(mpColor),
                        opacity: 0.88,
                      },
                      hovertemplate:
                        `<b>%{y}</b><br>${t("analysis.overview.manpowerMetric")}: %{x:,.0f}<extra></extra>`,
                    },
                  ]}
                  layout={{
                    ...BASE,
                    margin: { l: 56, r: 80, t: 8, b: 40 },
                    xaxis: {
                      title: t("analysis.overview.manpower"),
                      gridcolor: "rgba(23,34,38,0.08)",
                      tickformat: "~s",
                    },
                    yaxis: {
                      automargin: true,
                      tickfont: {
                        family: '"IBM Plex Mono",monospace',
                        size: 12,
                      },
                    },
                  }}
                  config={{ responsive: true, displaylogo: false }}
                  style={{ width: "100%", minHeight: 520 }}
                />
              </Suspense>
            </section>
            <section className="panel analyzer-chart-panel" style={{ flex: 1 }}>
              <div className="panel-head">
                <h2>{t("analysis.overview.navyAir")}</h2>
              </div>
              <Suspense
                fallback={<div style={{ minHeight: 520 }}>{t("analysis.overview.loading")}</div>}
              >
                <Plot
                  data={[
                    {
                      type: "bar",
                      orientation: "h",
                      name: t("analysis.overview.ships"),
                      x: [...navyAirRows].reverse().map((r) => r.ships),
                      y: [...navyAirRows]
                        .reverse()
                        .map((r) => countryFullName(r.tag)),
                      marker: { color: "#0b7a75", opacity: 0.85 },
                      hovertemplate: `<b>%{y}</b> ${t("analysis.overview.shipsMetric")}: %{x:,}<extra></extra>`,
                    },
                    {
                      type: "bar",
                      orientation: "h",
                      name: t("analysis.overview.aircraft"),
                      x: [...navyAirRows].reverse().map((r) => r.aircraft),
                      y: [...navyAirRows]
                        .reverse()
                        .map((r) => countryFullName(r.tag)),
                      marker: { color: "#f2a93b", opacity: 0.85 },
                      hovertemplate:
                        `<b>%{y}</b> ${t("analysis.overview.aircraftMetric")}: %{x:,}<extra></extra>`,
                    },
                  ]}
                  layout={{
                    ...BASE,
                    barmode: "stack",
                    margin: { l: 56, r: 20, t: 8, b: 40 },
                    legend: { orientation: "h", y: 1.08 },
                    xaxis: {
                      title: t("analysis.overview.count"),
                      gridcolor: "rgba(23,34,38,0.08)",
                      tickformat: "~s",
                    },
                    yaxis: {
                      automargin: true,
                      tickfont: {
                        family: '"IBM Plex Mono",monospace',
                        size: 12,
                      },
                    },
                  }}
                  config={{ responsive: true, displaylogo: false }}
                  style={{ width: "100%", minHeight: 520 }}
                />
              </Suspense>
            </section>
          </div>

          {/* Industry chart */}
          <section className="panel analyzer-chart-panel" style={{ marginTop: 18 }}>
            <div className="panel-head">
              <h2>{t("analysis.overview.warIndustry")}</h2>
              <div className="micro-copy">
                {t("analysis.overview.industryBreakdown")}
              </div>
            </div>
            <Suspense fallback={<div style={{ minHeight: 360 }}>{t("analysis.overview.loading")}</div>}>
              <Plot
                data={[
                  {
                    type: "bar",
                    orientation: "h",
                    name: t("analysis.overview.militaryFactoriesShort"),
                    x: [...industryRows]
                      .reverse()
                      .map((r) => r.effectiveMilitaryFactories),
                    y: industryY,
                    marker: { color: "#d94f2b", opacity: 0.85 },
                    hovertemplate:
                      `<b>%{text}</b> ${t("analysis.overview.militaryFactoriesShort")}: %{x}<extra></extra>`,
                    text: industryLabels,
                  },
                  {
                    type: "bar",
                    orientation: "h",
                    name: t("analysis.overview.civilianFactoriesShort"),
                    x: [...industryRows]
                      .reverse()
                      .map((r) => r.effectiveCivilianFactories),
                    y: industryY,
                    marker: { color: "#0b7a75", opacity: 0.85 },
                    hovertemplate:
                      `<b>%{text}</b> ${t("analysis.overview.civilianFactoriesShort")}: %{x}<extra></extra>`,
                    text: industryLabels,
                  },
                  {
                    type: "bar",
                    orientation: "h",
                    name: t("analysis.overview.dockyards"),
                    x: [...industryRows].reverse().map((r) => r.effectiveDockyards),
                    y: industryY,
                    marker: { color: "#7a8898", opacity: 0.85 },
                    hovertemplate:
                      `<b>%{text}</b> ${t("analysis.overview.dockyards")}: %{x}<extra></extra>`,
                    text: industryLabels,
                  },
                ]}
                layout={{
                  ...BASE,
                  barmode: "stack",
                  margin: { l: 160, r: 20, t: 8, b: 40 },
                  legend: { orientation: "h", y: 1.08 },
                  xaxis: { title: t("analysis.overview.count"), gridcolor: "rgba(23,34,38,0.08)" },
                  yaxis: {
                    tickmode: "array",
                    tickvals: industryY,
                    ticktext: industryLabels,
                    automargin: true,
                    tickfont: {
                      family: '"IBM Plex Mono",monospace',
                      size: 12,
                    },
                  },
                }}
                config={{ responsive: true, displaylogo: false }}
                style={{ width: "100%", minHeight: 360 }}
              />
            </Suspense>
          </section>

          {/* Thematic top-10 overview */}
          <section className="panel analyzer-chart-panel" style={{ marginTop: 18 }}>
            <div className="panel-head">
              <h2>{t("analysis.overview.thematicTop")}</h2>
              <div className="micro-copy">
                {t("analysis.overview.thematicLeaders")}
              </div>
            </div>
            <div
              className="analyzer-charts-row"
              style={{ gap: 14, flexWrap: "wrap" }}
            >
              <section className="panel analyzer-chart-panel" style={{ flex: 1, minWidth: 280 }}>
                <div className="panel-head">
                  <h3>{t("analysis.overview.industry")}</h3>
                  <div className="micro-copy">{t("analysis.overview.topFactories")}</div>
                </div>
                <Suspense
                  fallback={<div style={{ minHeight: 260 }}>{t("analysis.overview.loading")}</div>}
                >
                  <Plot
                    data={[
                      {
                        type: "bar",
                        orientation: "h",
                        x: topIndustry
                          .map(
                            (r) =>
                              r.effectiveMilitaryFactories +
                              r.effectiveCivilianFactories +
                              r.effectiveDockyards,
                          )
                          .reverse(),
                        y: topIndustry
                          .map((r) => countryFullName(r.tag))
                          .reverse(),
                        marker: { color: "#d94f2b", opacity: 0.85 },
                        hovertemplate:
                          `<b>%{y}</b><br>${t("analysis.overview.totalIndustry")}: %{x}<extra></extra>`,
                      },
                    ]}
                    layout={{
                      ...BASE,
                      margin: { l: 120, r: 20, t: 24, b: 40 },
                      xaxis: {
                        title: t("analysis.overview.total"),
                        gridcolor: "rgba(23,34,38,0.08)",
                      },
                      yaxis: {
                        automargin: true,
                        tickfont: {
                          family: '"IBM Plex Mono",monospace',
                          size: 11,
                        },
                      },
                    }}
                    config={{ responsive: true, displaylogo: false }}
                    style={{ width: "100%", minHeight: 260 }}
                  />
                </Suspense>
              </section>

              <section className="panel analyzer-chart-panel" style={{ flex: 1, minWidth: 280 }}>
                <div className="panel-head">
                  <h3>{t("analysis.overview.navy")}</h3>
                  <div className="micro-copy">{t("analysis.overview.topShips")}</div>
                </div>
                <Suspense
                  fallback={<div style={{ minHeight: 260 }}>{t("analysis.overview.loading")}</div>}
                >
                  <Plot
                    data={[
                      {
                        type: "bar",
                        orientation: "h",
                        x: topNavy.map((r) => r.ships).reverse(),
                        y: topNavy.map((r) => countryFullName(r.tag)).reverse(),
                        marker: { color: "#0b7a75", opacity: 0.85 },
                        hovertemplate:
                          `<b>%{y}</b><br>${t("analysis.overview.shipsMetric")}: %{x}<extra></extra>`,
                      },
                    ]}
                    layout={{
                      ...BASE,
                      margin: { l: 120, r: 20, t: 24, b: 40 },
                      xaxis: {
                        title: t("analysis.overview.ships"),
                        gridcolor: "rgba(23,34,38,0.08)",
                      },
                      yaxis: {
                        automargin: true,
                        tickfont: {
                          family: '"IBM Plex Mono",monospace',
                          size: 11,
                        },
                      },
                    }}
                    config={{ responsive: true, displaylogo: false }}
                    style={{ width: "100%", minHeight: 260 }}
                  />
                </Suspense>
              </section>

              <section className="panel analyzer-chart-panel" style={{ flex: 1, minWidth: 280 }}>
                <div className="panel-head">
                  <h3>{t("analysis.overview.air")}</h3>
                  <div className="micro-copy">{t("analysis.overview.topAircraft")}</div>
                </div>
                <Suspense
                  fallback={<div style={{ minHeight: 260 }}>{t("analysis.overview.loading")}</div>}
                >
                  <Plot
                    data={[
                      {
                        type: "bar",
                        orientation: "h",
                        x: topAir.map((r) => r.aircraft).reverse(),
                        y: topAir.map((r) => countryFullName(r.tag)).reverse(),
                        marker: { color: "#f2a93b", opacity: 0.85 },
                        hovertemplate:
                          `<b>%{y}</b><br>${t("analysis.overview.aircraftMetric")}: %{x}<extra></extra>`,
                      },
                    ]}
                    layout={{
                      ...BASE,
                      margin: { l: 120, r: 20, t: 24, b: 40 },
                      xaxis: {
                        title: t("analysis.overview.aircraft"),
                        gridcolor: "rgba(23,34,38,0.08)",
                      },
                      yaxis: {
                        automargin: true,
                        tickfont: {
                          family: '"IBM Plex Mono",monospace',
                          size: 11,
                        },
                      },
                    }}
                    config={{ responsive: true, displaylogo: false }}
                    style={{ width: "100%", minHeight: 260 }}
                  />
                </Suspense>
              </section>

              <section className="panel analyzer-chart-panel" style={{ flex: 1, minWidth: 280 }}>
                <div className="panel-head">
                  <h3>{t("analysis.overview.mobilization")}</h3>
                  <div className="micro-copy">{t("analysis.overview.manpowerPools")}</div>
                </div>
                <Suspense
                  fallback={<div style={{ minHeight: 260 }}>{t("analysis.overview.loading")}</div>}
                >
                  <Plot
                    data={[
                      {
                        type: "bar",
                        orientation: "h",
                        x: topMobilization
                          .map((r) => r.manpowerInField)
                          .reverse(),
                        y: topMobilization
                          .map((r) => countryFullName(r.tag))
                          .reverse(),
                        marker: { color: "#7a8898", opacity: 0.85 },
                        hovertemplate:
                          `<b>%{y}</b><br>${t("analysis.overview.manpowerMetric")}: %{x}<extra></extra>`,
                      },
                    ]}
                    layout={{
                      ...BASE,
                      margin: { l: 120, r: 20, t: 24, b: 40 },
                      xaxis: {
                        title: t("analysis.overview.manpowerMetric"),
                        gridcolor: "rgba(23,34,38,0.08)",
                      },
                      yaxis: {
                        automargin: true,
                        tickfont: {
                          family: '"IBM Plex Mono",monospace',
                          size: 11,
                        },
                      },
                    }}
                    config={{ responsive: true, displaylogo: false }}
                    style={{ width: "100%", minHeight: 260 }}
                  />
                </Suspense>
              </section>

              <section className="panel analyzer-chart-panel" style={{ flex: 1, minWidth: 280 }}>
                <div className="panel-head">
                  <h3>{t("analysis.overview.equipment")}</h3>
                  <div className="micro-copy">{t("analysis.overview.equipmentCountries")}</div>
                </div>
                <Suspense
                  fallback={<div style={{ minHeight: 260 }}>{t("analysis.overview.loading")}</div>}
                >
                  <Plot
                    data={[
                      {
                        type: "bar",
                        orientation: "h",
                        x: topEquipmentValues.reverse(),
                        y: topEquipmentLabels.reverse(),
                        marker: { color: "rgba(11,122,117,0.75)" },
                        hovertemplate:
                          `<b>%{y}</b><br>${t("analysis.overview.equipment")}: %{x}<extra></extra>`,
                      },
                    ]}
                    layout={{
                      ...BASE,
                      margin: { l: 120, r: 20, t: 24, b: 40 },
                      xaxis: {
                        title: t("analysis.overview.equipmentUnits"),
                        gridcolor: "rgba(23,34,38,0.08)",
                      },
                      yaxis: {
                        automargin: true,
                        tickfont: {
                          family: '"IBM Plex Mono",monospace',
                          size: 11,
                        },
                      },
                    }}
                    config={{ responsive: true, displaylogo: false }}
                    style={{ width: "100%", minHeight: 260 }}
                  />
                </Suspense>
              </section>
            </div>
          </section>
          {/* Full table */}
          {/* Equipment section */}
          {showEq && eqCountries.length > 0 && (
            <section className="panel analyzer-chart-panel" style={{ marginTop: 18 }}>
              <div className="panel-head">
                <h2>{t("analysis.overview.equipmentByCountry")}</h2>
                <label
                  className="field"
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 14px",
                  }}
                >
                  <span>{t("common.country")}</span>
                  <select
                    value={eqCountry}
                    onChange={(e) => setEqCountry(e.target.value)}
                    style={{
                      border: "1px solid var(--line)",
                      borderRadius: 12,
                      padding: "8px 14px",
                      font: "inherit",
                    }}
                  >
                    {eqCountries.map((c) => (
                      <option key={c} value={c}>
                        {formatCountryDisplayName(c)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="analyzer-charts-row">
                <Suspense
                  fallback={
                    <div style={{ flex: 2, minHeight: 440 }}>{t("analysis.overview.loading")}</div>
                  }
                >
                  <Plot
                    data={[
                      {
                        type: "bar",
                        orientation: "h",
                        x: [...eqEntries].reverse().map(([, v]) => v),
                        y: [...eqEntries]
                          .reverse()
                          .map(([k]) => shortEqName(k)),
                        marker: { color: "rgba(11,122,117,0.75)" },
                        hovertemplate:
                          `<b>%{y}</b><br>${t("analysis.overview.amount")}: %{x:,.0f}<extra></extra>`,
                      },
                    ]}
                    layout={{
                      ...BASE,
                      margin: { l: 220, r: 60, t: 32, b: 40 },
                      title: {
                        text: t("analysis.overview.countryEquipmentBreakdown", { country: countryFullName(eqCountry) }),
                        font: { size: 15 },
                        y: 0.95,
                      },
                      xaxis: {
                        title: t("analysis.overview.count"),
                        gridcolor: "rgba(23,34,38,0.08)",
                        tickformat: ",.0f",
                      },
                      yaxis: {
                        automargin: true,
                        tickfont: {
                          family: '"IBM Plex Mono",monospace',
                          size: 11,
                        },
                      },
                    }}
                    config={{ responsive: true, displaylogo: false }}
                    style={{ flex: 2, minHeight: 440 }}
                  />
                </Suspense>
                <Suspense
                  fallback={
                    <div style={{ flex: 1, minHeight: 440 }}>{t("analysis.overview.loading")}</div>
                  }
                >
                  <Plot
                    data={[
                      {
                        type: "bar",
                        orientation: "h",
                        x: [...worldEntries].reverse().map(([, v]) => v),
                        y: [...worldEntries]
                          .reverse()
                          .map(([k]) => shortEqName(k)),
                        marker: { color: "rgba(217,79,43,0.72)" },
                        hovertemplate:
                          `<b>%{y}</b><br>${t("analysis.overview.world")}: %{x:,.0f}<extra></extra>`,
                      },
                    ]}
                    layout={{
                      ...BASE,
                      margin: { l: 200, r: 20, t: 32, b: 40 },
                      title: {
                        text: t("analysis.overview.worldTotalsTop", { count: 20 }),
                        font: { size: 15 },
                        y: 0.95,
                      },
                      xaxis: {
                        title: t("analysis.overview.worldTotal"),
                        gridcolor: "rgba(23,34,38,0.08)",
                        tickformat: "~s",
                      },
                      yaxis: {
                        automargin: true,
                        tickfont: {
                          family: '"IBM Plex Mono",monospace',
                          size: 11,
                        },
                      },
                    }}
                    config={{ responsive: true, displaylogo: false }}
                    style={{ flex: 1, minHeight: 440 }}
                  />
                </Suspense>
              </div>
            </section>
          )}

            </>
          )}
        </>
      )}

      {!readOnly && comparisonState && (
        <AnalysisComparison
          items={comparisonState.items}
          busy={comparisonState.busy}
          optionsLoading={comparisonState.optionsLoading}
          optionsUnavailable={comparisonState.optionsUnavailable}
          onUnavailable={comparisonState.retryOptions}
          onRetryOptions={comparisonState.retryOptions}
          onAnalyzeSave={() =>
            document
              .querySelector<HTMLButtonElement>(
                "#analyze-one-save .button-primary",
              )
              ?.click()
          }
        />
      )}

      {result && analysisView === "overview" && (
          <section className="panel" style={{ marginTop: 18 }}>
            <div className="panel-head">
              <h2>{t("analysis.overview.allCountries")}</h2>
              <div className="analyzer-table-controls">
                <input
                  type="text"
                  placeholder={t("analysis.overview.filterCountry")}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    padding: "8px 14px",
                    font: "inherit",
                    width: 180,
                  }}
                />
                <span className="micro-copy">
                  {t("analysis.overview.showingCountries", { shown: sortedRows.length, total: result.by_country.length })}
                </span>
                <button
                  className="button button-secondary"
                  style={{ padding: "8px 16px", fontSize: 14 }}
                  onClick={() => setShowEq((v) => !v)}
                >
                  {showEq ? t("analysis.overview.hideEquipment") : t("analysis.overview.showEquipment")}
                </button>
              </div>
            </div>
            <div className="table-wrap">
              <table className="recent-table analyzer-table">
                <thead>
                  <tr>
                    <SortTh col="tag" label={t("common.country")} />
                    <SortTh col="manpowerInField" label={t("analysis.overview.manpowerMetric")} />
                    <SortTh col="divisions" label={t("analysis.overview.divisions")} />
                    <SortTh col="aircraft" label={t("analysis.overview.aircraft")} />
                    <SortTh col="ships" label={t("analysis.overview.ships")} />
                    <SortTh col="effectiveMilitaryFactories" label={t("analysis.overview.militaryFactoriesShort")} />
                    <SortTh col="effectiveCivilianFactories" label={t("analysis.overview.civilianFactoriesShort")} />
                    <SortTh col="effectiveDockyards" label={t("analysis.overview.dockyards")} />
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r, i) => (
                    <tr key={r.tag}>
                      <td className="country-cell analyzer-country-rank-cell">
                        <span style={{ color: "var(--muted)", marginRight: 8 }}>
                          {i + 1}
                        </span>
                        <CountryDisplay tag={r.tag} />
                      </td>
                      <td>
                        {r.manpowerInField
                          ? r.manpowerInField.toLocaleString()
                          : "—"}
                      </td>
                      <td>
                        {r.divisions ? r.divisions.toLocaleString() : "—"}
                      </td>
                      <td>{r.aircraft ? r.aircraft.toLocaleString() : "—"}</td>
                      <td>{r.ships ? r.ships.toLocaleString() : "—"}</td>
                      <td>
                        {r.effectiveMilitaryFactories
                          ? r.effectiveMilitaryFactories.toLocaleString()
                          : "—"}
                      </td>
                      <td>
                        {r.effectiveCivilianFactories
                          ? r.effectiveCivilianFactories.toLocaleString()
                          : "—"}
                      </td>
                      <td>
                        {r.effectiveDockyards ? r.effectiveDockyards.toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
      )}
    </div>
  );
}
