import React, { Suspense, useState, useEffect, useMemo } from "react";
import type {
  SoldiersApiResponse,
  SoldiersEntry,
  SoldiersTimelineEntry,
} from "@/types";
import { usePlotTheme } from "@/hooks/usePlotTheme";

const Plot = React.lazy(() => import("react-plotly.js"));

function filteredTimeline(timeline: SoldiersTimelineEntry[], unique: boolean) {
  if (!unique) return timeline;
  const seen = new Set<string>();
  const out: SoldiersTimelineEntry[] = [];
  for (const e of timeline) {
    const k = e.game_date ?? e.real_time ?? "";
    if (!seen.has(k)) {
      seen.add(k);
      out.push(e);
    }
  }
  return out;
}

export function SoldiersTab() {
  const BASE = usePlotTheme();
  const [data, setData] = useState<SoldiersApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [topN, setTopN] = useState(10);
  const [unique, setUnique] = useState(true);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/soldiers?ts=${Date.now()}`)
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const timeline = useMemo(
    () => (data ? filteredTimeline(data.timeline, unique) : []),
    [data, unique],
  );
  const topTags = useMemo(
    () => (data?.latest_ranked ?? []).slice(0, topN).map((r) => r.tag),
    [data, topN],
  );
  const xLabels = useMemo(
    () => timeline.map((e) => e.game_date ?? e.real_time ?? ""),
    [timeline],
  );

  const areaTraces = useMemo(
    () =>
      topTags.map((tag) => ({
        type: "scatter" as const,
        mode: "lines" as const,
        name: tag,
        stackgroup: "one",
        x: xLabels,
        y: timeline.map(
          (e) => (e[tag] as SoldiersEntry | undefined)?.manpower ?? 0,
        ),
        hovertemplate: `<b>${tag}</b><br>%{x}<br>%{y:,.0f}<extra></extra>`,
        line: { width: 1.5 },
      })),
    [topTags, timeline, xLabels],
  );

  const detailTraces = useMemo(() => {
    if (!selectedTag) return [];
    return [
      {
        type: "scatter" as const,
        mode: "lines+markers" as const,
        name: "Manpower",
        x: xLabels,
        y: timeline.map(
          (e) => (e[selectedTag] as SoldiersEntry | undefined)?.manpower ?? 0,
        ),
        line: { width: 2.5 },
        marker: { size: 5 },
      },
      {
        type: "scatter" as const,
        mode: "lines+markers" as const,
        name: "Divisions",
        x: xLabels,
        y: timeline.map(
          (e) => (e[selectedTag] as SoldiersEntry | undefined)?.divisions ?? 0,
        ),
        yaxis: "y2",
        line: { width: 1.5, dash: "dot" as const },
        marker: { size: 4 },
      },
    ];
  }, [selectedTag, timeline, xLabels]);

  if (loading)
    return (
      <div className="micro-copy" style={{ padding: 24 }}>
        Loading…
      </div>
    );
  const ranked = data?.latest_ranked ?? [];

  return (
    <div className="soldiers-layout">
      <div className="soldiers-top">
        <section className="panel">
          <div className="panel-head">
            <h2>Ranking (latest save)</h2>
            <div className="micro-copy">Sorted by manpower</div>
          </div>
          <div className="table-wrap">
            <table className="recent-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Country</th>
                  <th>Divisions</th>
                  <th>Manpower</th>
                  <th>Avg/div</th>
                </tr>
              </thead>
              <tbody>
                {!ranked.length ? (
                  <tr>
                    <td
                      colSpan={5}
                      style={{ padding: 16, color: "var(--muted)" }}
                    >
                      No data yet — run tracker to collect saves.
                    </td>
                  </tr>
                ) : (
                  ranked.map((row, i) => (
                    <tr
                      key={row.tag}
                      style={{
                        cursor: "pointer",
                        background:
                          selectedTag === row.tag
                            ? "rgba(217,79,43,0.08)"
                            : undefined,
                      }}
                      onClick={() => setSelectedTag(row.tag)}
                    >
                      <td>{i + 1}</td>
                      <td>
                        <strong>{row.tag}</strong>
                      </td>
                      <td>{row.divisions.toLocaleString()}</td>
                      <td>{row.manpower.toLocaleString()}</td>
                      <td>{row.avg_manpower.toFixed(1)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Top-N over time</h2>
            <div className="soldiers-controls">
              <label
                className="field"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                }}
              >
                <span>Top</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={topN}
                  onChange={(e) =>
                    setTopN(Math.max(1, parseInt(e.target.value) || 10))
                  }
                  style={{
                    width: 56,
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    padding: "6px 8px",
                    font: "inherit",
                  }}
                />
              </label>
              <label className="toggle" style={{ padding: "8px 12px" }}>
                <input
                  type="checkbox"
                  checked={unique}
                  onChange={(e) => setUnique(e.target.checked)}
                />
                <span>Unique game dates</span>
              </label>
            </div>
          </div>
          <Suspense fallback={<div style={{ minHeight: 460 }}>Loading…</div>}>
            <Plot
              data={areaTraces}
              layout={{
                ...BASE,
                margin: { l: 64, r: 20, t: 10, b: 60 },
                hovermode: "x unified",
                legend: { orientation: "h", y: 1.08 },
                xaxis: {
                  title: "Game date",
                  tickangle: -25,
                  gridcolor: "rgba(23,34,38,0.08)",
                },
                yaxis: {
                  title: "Total manpower",
                  gridcolor: "rgba(23,34,38,0.08)",
                },
              }}
              config={{ responsive: true, displaylogo: false }}
              style={{ width: "100%", minHeight: 460 }}
            />
          </Suspense>
        </section>
      </div>
      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2>Single country detail</h2>
          <div className="micro-copy">Click a row to trace</div>
        </div>
        {selectedTag ? (
          <Suspense fallback={<div style={{ minHeight: 320 }}>Loading…</div>}>
            <Plot
              data={detailTraces}
              layout={{
                ...BASE,
                title: {
                  text: `${selectedTag} — manpower timeline`,
                  font: { size: 16 },
                },
                margin: { l: 64, r: 80, t: 36, b: 60 },
                hovermode: "x unified",
                legend: { orientation: "h", y: 1.12 },
                xaxis: {
                  title: "Game date",
                  tickangle: -25,
                  gridcolor: "rgba(23,34,38,0.08)",
                },
                yaxis: {
                  title: "Manpower",
                  gridcolor: "rgba(23,34,38,0.08)",
                },
                yaxis2: {
                  title: "Divisions",
                  overlaying: "y",
                  side: "right",
                  showgrid: false,
                },
              }}
              config={{ responsive: true, displaylogo: false }}
              style={{ width: "100%", minHeight: 320 }}
            />
          </Suspense>
        ) : (
          <div className="micro-copy" style={{ padding: 20 }}>
            Click a row above.
          </div>
        )}
      </section>
    </div>
  );
}
