import React, {
  Suspense,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import type { AnalyzeResult, CountryStats } from "@/types";
import { SummaryGrid } from "@/components/ui/SummaryGrid";
import { fmtBig, shortEqName, countryFullName } from "@/lib/utils";
import { usePlotTheme } from "@/hooks/usePlotTheme";
import { WarCasualtiesTab } from "./WarCasualtiesTab";
import { NavalLossesTab } from "./NavalLossesTab";

const Plot = React.lazy(() => import("react-plotly.js"));

interface SaveFile {
  name: string;
  path: string;
  size_mb: number;
  modified: string;
}
type SortCol = keyof CountryStats;

function SaveBrowser({
  onSelect,
}: {
  onSelect: (p: string, n: string) => void;
}) {
  const [dir, setDir] = useState("");
  const [editDir, setEditDir] = useState("");
  const [editing, setEditing] = useState(false);
  const [files, setFiles] = useState<SaveFile[]>([]);
  const [page, setPage] = useState(1);
  const [exists, setExists] = useState(true);
  const [loading, setLoading] = useState(true);

  const PAGE_SIZE = 10;

  const loadDir = useCallback(async (scanDir?: string) => {
    setLoading(true);
    try {
      const url = scanDir
        ? `/api/saves?dir=${encodeURIComponent(scanDir)}`
        : "/api/saves";
      const data = (await fetch(url).then((r) => r.json())) as {
        dir: string;
        exists: boolean;
        files: SaveFile[];
      };
      setDir(data.dir);
      setEditDir(data.dir);
      setExists(data.exists);
      setFiles([...data.files].reverse());
      setPage(1);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDir();
  }, [loadDir]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Save Files</h2>
        <button
          className="button button-secondary"
          style={{ padding: "6px 14px", fontSize: 13 }}
          onClick={() => loadDir(dir)}
        >
          ↻ Refresh
        </button>
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 14,
          alignItems: "center",
        }}
      >
        {editing ? (
          <>
            <input
              value={editDir}
              onChange={(e) => setEditDir(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && (setEditing(false), loadDir(editDir))
              }
              style={{
                flex: 1,
                border: "1.5px solid var(--accent-2)",
                borderRadius: 12,
                padding: "10px 16px",
                font: '14px "IBM Plex Mono",monospace',
                color: "var(--ink)",
                background: "var(--paper-strong)",
                outline: "none",
              }}
              autoFocus
            />
            <button
              className="button button-primary"
              style={{ padding: "10px 16px", fontSize: 13 }}
              onClick={() => {
                setEditing(false);
                loadDir(editDir);
              }}
            >
              Open
            </button>
            <button
              className="button button-secondary"
              style={{ padding: "10px 14px", fontSize: 13 }}
              onClick={() => {
                setEditing(false);
                setEditDir(dir);
              }}
            >
              ✕
            </button>
          </>
        ) : (
          <>
            <div
              style={{
                flex: 1,
                fontFamily: '"IBM Plex Mono",monospace',
                fontSize: 13,
                color: "var(--muted)",
                background: "var(--paper-strong)",
                border: "1px solid var(--line)",
                borderRadius: 12,
                padding: "10px 16px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {dir || "…"}
            </div>
            <button
              className="button button-secondary"
              style={{ padding: "10px 14px", fontSize: 13 }}
              onClick={() => setEditing(true)}
              title="Change directory"
            >
              ✎
            </button>
          </>
        )}
      </div>
      {loading ? (
        <div className="micro-copy" style={{ padding: "16px 0" }}>
          Scanning…
        </div>
      ) : !exists ? (
        <div
          style={{ padding: "16px 0", color: "var(--accent)", fontSize: 14 }}
        >
          Directory not found. Click ✎ to change the path.
        </div>
      ) : files.length === 0 ? (
        <div className="micro-copy" style={{ padding: "16px 0" }}>
          No .hoi4 files found.
        </div>
      ) : (
        <>
          <div
            className="panel-head"
            style={{ justifyContent: "space-between", gap: 12 }}
          >
            <div />
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="micro-copy">
                Page {page} of{" "}
                {Math.max(1, Math.ceil(files.length / PAGE_SIZE))}
              </span>
              <button
                className="button button-secondary"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page === 1}
                style={{ padding: "6px 12px" }}
              >
                ← Prev
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
                Next →
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="recent-table">
              <thead>
                <tr>
                  <th>Save file</th>
                  <th style={{ textAlign: "right" }}>Size</th>
                  <th style={{ textAlign: "right" }}>Last modified</th>
                </tr>
              </thead>
              <tbody>
                {files
                  .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
                  .map((f) => (
                    <tr
                      key={f.path}
                      onClick={() => onSelect(f.path, f.name)}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                          "rgba(217,79,43,0.07)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "")
                      }
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
                      <td
                        style={{
                          textAlign: "right",
                          color: "var(--muted)",
                          fontSize: 13,
                        }}
                      >
                        {f.size_mb} MB
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color: "var(--muted)",
                          fontSize: 13,
                        }}
                      >
                        {fmt(f.modified)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export function AnalyzerTab() {
  const BASE = usePlotTheme();
  const [status, setStatus] = useState<{
    type: "idle" | "loading" | "ok" | "error";
    msg: string;
  }>({ type: "idle", msg: "" });
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [prevResult, setPrevResult] = useState<AnalyzeResult | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>("manpowerInField");
  const [sortAsc, setSortAsc] = useState(false);
  const [filter, setFilter] = useState("");
  const [showEq, setShowEq] = useState(false);
  const [eqCountry, setEqCountry] = useState("");
  const [navalLossCountryTag, setNavalLossCountryTag] = useState<
    string | null | undefined
  >(undefined);
  const [analysisView, setAnalysisView] = useState<
    "overview" | "war-casualties" | "naval-losses"
  >("overview");

  const analyze = async (filePath: string, fileName: string) => {
    setStatus({ type: "loading", msg: `Parsing ${fileName}… 10–20 s` });
    setResult(null);
    try {
      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      });
      const text = await resp.text();
      let data: AnalyzeResult;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `Non-JSON (${resp.status}): ${text.slice(0, 200) || "(empty)"}`,
        );
      }
      if (!resp.ok)
        throw new Error(
          (data as unknown as { error?: string }).error ??
            `HTTP ${resp.status}`,
        );
      setPrevResult(result);
      setResult(data);
      setAnalysisView("overview");
      const initialEqCountry =
        Object.keys(data.equipment_by_country).sort()[0] ??
        data.by_country[0]?.tag ??
        "";
      setEqCountry(initialEqCountry);
      setShowEq(true);
      setStatus({
        type: "ok",
        msg: `✓ ${fileName}  —  ${data.parse_seconds}s · ${data.file_size_mb} MB · ${data.game_date}`,
      });
    } catch (e) {
      setStatus({
        type: "error",
        msg: e instanceof Error ? e.message : String(e),
      });
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
            r.militaryFactories > 0 ||
            r.civilianFactories > 0 ||
            r.dockyards > 0,
        )
        .sort(
          (a, b) =>
            b.militaryFactories +
            b.civilianFactories -
            (a.militaryFactories + a.civilianFactories),
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
        result.totals.militaryFactories +
        result.totals.civilianFactories +
        result.totals.dockyards -
        (prevTotals.militaryFactories +
          prevTotals.civilianFactories +
          prevTotals.dockyards),
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
        label: "Game date",
        value: result.game_date,
        sub: `${result.file_size_mb} MB file`,
      },
      {
        label: "Active countries",
        value: result.active_countries,
        sub: "states with an owner",
      },
      {
        label: "Total manpower",
        value: fmtBig(result.totals.manpowerInField),
        sub: `${result.totals.divisions.toLocaleString()} divisions`,
      },
      {
        label: "War industry",
        value: result.totals.militaryFactories.toLocaleString(),
        sub: `mil fac · ${result.totals.civilianFactories} civ · ${result.totals.dockyards} dockyards`,
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
          label: "Ships Δ",
          value: renderDelta(diffTotals.ships),
          sub: "vs previous save",
        },
        {
          label: "Aircraft Δ",
          value: renderDelta(diffTotals.aircraft),
          sub: "vs previous save",
        },
        {
          label: "Manpower Δ",
          value: renderDelta(diffTotals.manpowerInField),
          sub: "vs previous save",
        },
      );
    }
    return cards;
  }, [result, diffTotals]);

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

  return (
    <div className="analyzer-shell">
      <SaveBrowser onSelect={analyze} />

      {status.type !== "idle" && (
        <div
          className={`panel analyzer-status ${status.type}`}
          style={{ padding: "14px 20px" }}
        >
          {status.type === "loading" && <span className="spinner" />}
          {status.msg}
        </div>
      )}

      {result && (
        <>
          <div
            className="tab-bar analyzer-view-tabs"
            role="tablist"
            aria-label="Save analysis views"
          >
            <button
              className={`tab-btn${analysisView === "overview" ? " active" : ""}`}
              onClick={() => setAnalysisView("overview")}
              role="tab"
              aria-selected={analysisView === "overview"}
            >
              Overview
            </button>
            <button
              className={`tab-btn${analysisView === "war-casualties" ? " active" : ""}`}
              onClick={() => setAnalysisView("war-casualties")}
              role="tab"
              aria-selected={analysisView === "war-casualties"}
            >
              War Casualties
            </button>
            <button
              className={`tab-btn${analysisView === "naval-losses" ? " active" : ""}`}
              onClick={() => setAnalysisView("naval-losses")}
              role="tab"
              aria-selected={analysisView === "naval-losses"}
            >
              Naval Losses
            </button>
          </div>

          {analysisView === "war-casualties" ? (
            <WarCasualtiesTab countries={result.by_country} />
          ) : analysisView === "naval-losses" ? (
            <NavalLossesTab
              summaries={result.navalLossSummaries}
              events={result.navalLosses}
              selectedTag={navalLossCountryTag}
              onSelect={setNavalLossCountryTag}
            />
          ) : (
            <>
          {/* Summary cards — derived from totals: CountryTotals */}
          <SummaryGrid cards={summaryCards} />

          {/* Manpower + Navy/Air charts */}
          <div className="analyzer-charts-row">
            <section className="panel" style={{ flex: 2 }}>
              <div className="panel-head">
                <h2>Manpower in Field</h2>
                <div className="micro-copy">Top {mpRows.length}</div>
              </div>
              <Suspense
                fallback={<div style={{ minHeight: 520 }}>Loading…</div>}
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
                        "<b>%{y}</b><br>Manpower: %{x:,.0f}<extra></extra>",
                    },
                  ]}
                  layout={{
                    ...BASE,
                    margin: { l: 56, r: 80, t: 8, b: 40 },
                    xaxis: {
                      title: "Manpower in field",
                      gridcolor: "rgba(23,34,38,0.08)",
                      tickformat: "~s",
                    },
                    yaxis: {
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
            <section className="panel" style={{ flex: 1 }}>
              <div className="panel-head">
                <h2>Navy &amp; Air Force</h2>
              </div>
              <Suspense
                fallback={<div style={{ minHeight: 520 }}>Loading…</div>}
              >
                <Plot
                  data={[
                    {
                      type: "bar",
                      orientation: "h",
                      name: "Ships",
                      x: [...navyAirRows].reverse().map((r) => r.ships),
                      y: [...navyAirRows]
                        .reverse()
                        .map((r) => countryFullName(r.tag)),
                      marker: { color: "#0b7a75", opacity: 0.85 },
                      hovertemplate: "<b>%{y}</b> ships: %{x:,}<extra></extra>",
                    },
                    {
                      type: "bar",
                      orientation: "h",
                      name: "Aircraft",
                      x: [...navyAirRows].reverse().map((r) => r.aircraft),
                      y: [...navyAirRows]
                        .reverse()
                        .map((r) => countryFullName(r.tag)),
                      marker: { color: "#f2a93b", opacity: 0.85 },
                      hovertemplate:
                        "<b>%{y}</b> aircraft: %{x:,}<extra></extra>",
                    },
                  ]}
                  layout={{
                    ...BASE,
                    barmode: "stack",
                    margin: { l: 56, r: 20, t: 8, b: 40 },
                    legend: { orientation: "h", y: 1.08 },
                    xaxis: {
                      title: "Count",
                      gridcolor: "rgba(23,34,38,0.08)",
                      tickformat: "~s",
                    },
                    yaxis: {
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
          <section className="panel" style={{ marginTop: 18 }}>
            <div className="panel-head">
              <h2>War Industry</h2>
              <div className="micro-copy">
                Military / Civilian factories &amp; Dockyards
              </div>
            </div>
            <Suspense fallback={<div style={{ minHeight: 360 }}>Loading…</div>}>
              <Plot
                data={[
                  {
                    type: "bar",
                    orientation: "h",
                    name: "Mil. factories",
                    x: [...industryRows]
                      .reverse()
                      .map((r) => r.militaryFactories),
                    y: industryY,
                    marker: { color: "#d94f2b", opacity: 0.85 },
                    hovertemplate:
                      "<b>%{text}</b> mil. fac: %{x}<extra></extra>",
                    text: industryLabels,
                  },
                  {
                    type: "bar",
                    orientation: "h",
                    name: "Civ. factories",
                    x: [...industryRows]
                      .reverse()
                      .map((r) => r.civilianFactories),
                    y: industryY,
                    marker: { color: "#0b7a75", opacity: 0.85 },
                    hovertemplate:
                      "<b>%{text}</b> civ. fac: %{x}<extra></extra>",
                    text: industryLabels,
                  },
                  {
                    type: "bar",
                    orientation: "h",
                    name: "Dockyards",
                    x: [...industryRows].reverse().map((r) => r.dockyards),
                    y: industryY,
                    marker: { color: "#7a8898", opacity: 0.85 },
                    hovertemplate:
                      "<b>%{text}</b> dockyards: %{x}<extra></extra>",
                    text: industryLabels,
                  },
                ]}
                layout={{
                  ...BASE,
                  barmode: "stack",
                  margin: { l: 160, r: 20, t: 8, b: 40 },
                  legend: { orientation: "h", y: 1.08 },
                  xaxis: { title: "Count", gridcolor: "rgba(23,34,38,0.08)" },
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
          <section className="panel" style={{ marginTop: 18 }}>
            <div className="panel-head">
              <h2>Thematic Top 10</h2>
              <div className="micro-copy">
                Industry, Navy, Air, Mobilization, Equipment leaders
              </div>
            </div>
            <div
              className="analyzer-charts-row"
              style={{ gap: 14, flexWrap: "wrap" }}
            >
              <section className="panel" style={{ flex: 1, minWidth: 280 }}>
                <div className="panel-head">
                  <h3>Industry</h3>
                  <div className="micro-copy">Top 10 factories</div>
                </div>
                <Suspense
                  fallback={<div style={{ minHeight: 260 }}>Loading…</div>}
                >
                  <Plot
                    data={[
                      {
                        type: "bar",
                        orientation: "h",
                        x: topIndustry
                          .map(
                            (r) =>
                              r.militaryFactories +
                              r.civilianFactories +
                              r.dockyards,
                          )
                          .reverse(),
                        y: topIndustry
                          .map((r) => countryFullName(r.tag))
                          .reverse(),
                        marker: { color: "#d94f2b", opacity: 0.85 },
                        hovertemplate:
                          "<b>%{y}</b><br>Total industry: %{x}<extra></extra>",
                      },
                    ]}
                    layout={{
                      ...BASE,
                      margin: { l: 120, r: 20, t: 24, b: 40 },
                      xaxis: {
                        title: "Total",
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

              <section className="panel" style={{ flex: 1, minWidth: 280 }}>
                <div className="panel-head">
                  <h3>Navy</h3>
                  <div className="micro-copy">Top 10 ship counts</div>
                </div>
                <Suspense
                  fallback={<div style={{ minHeight: 260 }}>Loading…</div>}
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
                          "<b>%{y}</b><br>Ships: %{x}<extra></extra>",
                      },
                    ]}
                    layout={{
                      ...BASE,
                      margin: { l: 120, r: 20, t: 24, b: 40 },
                      xaxis: {
                        title: "Ships",
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

              <section className="panel" style={{ flex: 1, minWidth: 280 }}>
                <div className="panel-head">
                  <h3>Air</h3>
                  <div className="micro-copy">Top 10 aircraft counts</div>
                </div>
                <Suspense
                  fallback={<div style={{ minHeight: 260 }}>Loading…</div>}
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
                          "<b>%{y}</b><br>Aircraft: %{x}<extra></extra>",
                      },
                    ]}
                    layout={{
                      ...BASE,
                      margin: { l: 120, r: 20, t: 24, b: 40 },
                      xaxis: {
                        title: "Aircraft",
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

              <section className="panel" style={{ flex: 1, minWidth: 280 }}>
                <div className="panel-head">
                  <h3>Mobilization</h3>
                  <div className="micro-copy">Top 10 manpower pools</div>
                </div>
                <Suspense
                  fallback={<div style={{ minHeight: 260 }}>Loading…</div>}
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
                          "<b>%{y}</b><br>Manpower: %{x}<extra></extra>",
                      },
                    ]}
                    layout={{
                      ...BASE,
                      margin: { l: 120, r: 20, t: 24, b: 40 },
                      xaxis: {
                        title: "Manpower",
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

              <section className="panel" style={{ flex: 1, minWidth: 280 }}>
                <div className="panel-head">
                  <h3>Equipment</h3>
                  <div className="micro-copy">Top 10 equipment countries</div>
                </div>
                <Suspense
                  fallback={<div style={{ minHeight: 260 }}>Loading…</div>}
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
                          "<b>%{y}</b><br>Equipment: %{x}<extra></extra>",
                      },
                    ]}
                    layout={{
                      ...BASE,
                      margin: { l: 120, r: 20, t: 24, b: 40 },
                      xaxis: {
                        title: "Units",
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
            <section className="panel" style={{ marginTop: 18 }}>
              <div className="panel-head">
                <h2>Equipment by Country</h2>
                <label
                  className="field"
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 14px",
                  }}
                >
                  <span>Country</span>
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
                        {countryFullName(c)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="analyzer-charts-row">
                <Suspense
                  fallback={
                    <div style={{ flex: 2, minHeight: 440 }}>Loading…</div>
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
                          "<b>%{y}</b><br>Amount: %{x:,.0f}<extra></extra>",
                      },
                    ]}
                    layout={{
                      ...BASE,
                      margin: { l: 220, r: 60, t: 32, b: 40 },
                      title: {
                        text: `${countryFullName(eqCountry)} — country equipment breakdown`,
                        font: { size: 15 },
                        y: 0.95,
                      },
                      xaxis: {
                        title: "Count",
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
                    <div style={{ flex: 1, minHeight: 440 }}>Loading…</div>
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
                          "<b>%{y}</b><br>World: %{x:,.0f}<extra></extra>",
                      },
                    ]}
                    layout={{
                      ...BASE,
                      margin: { l: 200, r: 20, t: 32, b: 40 },
                      title: {
                        text: "World totals — top 20",
                        font: { size: 15 },
                        y: 0.95,
                      },
                      xaxis: {
                        title: "World total",
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

          <section className="panel" style={{ marginTop: 18 }}>
            <div className="panel-head">
              <h2>All Countries</h2>
              <div className="analyzer-table-controls">
                <input
                  type="text"
                  placeholder="Filter by country…"
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
                  {sortedRows.length} of {result.by_country.length}
                </span>
                <button
                  className="button button-secondary"
                  style={{ padding: "8px 16px", fontSize: 14 }}
                  onClick={() => setShowEq((v) => !v)}
                >
                  {showEq ? "Hide Equipment" : "Show Equipment"}
                </button>
              </div>
            </div>
            <div className="table-wrap">
              <table className="recent-table analyzer-table">
                <thead>
                  <tr>
                    <SortTh col="tag" label="Country" />
                    <SortTh col="manpowerInField" label="Manpower" />
                    <SortTh col="divisions" label="Divisions" />
                    <SortTh col="aircraft" label="Aircraft" />
                    <SortTh col="ships" label="Ships" />
                    <SortTh col="militaryFactories" label="Mil. fac." />
                    <SortTh col="civilianFactories" label="Civ. fac." />
                    <SortTh col="dockyards" label="Dockyards" />
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r, i) => (
                    <tr key={r.tag}>
                      <td>
                        <span style={{ color: "var(--muted)", marginRight: 8 }}>
                          {i + 1}
                        </span>
                        <strong>{countryFullName(r.tag)}</strong>
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
                        {r.militaryFactories
                          ? r.militaryFactories.toLocaleString()
                          : "—"}
                      </td>
                      <td>
                        {r.civilianFactories
                          ? r.civilianFactories.toLocaleString()
                          : "—"}
                      </td>
                      <td>
                        {r.dockyards ? r.dockyards.toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
