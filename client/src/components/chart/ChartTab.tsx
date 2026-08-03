import React, { Suspense, useState, useMemo, useCallback } from "react";
import type { SaveRecord, XMode } from "@/types";
import {
  NUMERIC_METRICS,
  PRESETS,
  buildXAxis,
  filterUniqueByDate,
  movingAverage,
  normalizeSeries,
  loadSettings,
  saveSettings,
} from "@/lib/utils";
import { usePlotTheme } from "@/hooks/usePlotTheme";

const Plot = React.lazy(() => import("react-plotly.js"));

interface Settings {
  xMode: XMode;
  maWindow: number;
  normalize: boolean;
  uniqueGameDateOnly: boolean;
  separateScale: boolean;
  autoScale: boolean;
  metrics: string[];
  lastPreset: string;
}
const DEFAULTS: Settings = {
  xMode: "save_index",
  maWindow: 1,
  normalize: false,
  uniqueGameDateOnly: false,
  separateScale: false,
  autoScale: true,
  metrics: ["divisions", "ships", "planes"],
  lastPreset: "",
};

export function ChartTab({ records }: { records: SaveRecord[] }) {
  const BASE = usePlotTheme();
  const [s, setS] = useState<Settings>(() => loadSettings(DEFAULTS));

  const update = useCallback((patch: Partial<Settings>) => {
    setS((prev) => {
      const next = { ...prev, ...patch };
      if (next.normalize) next.separateScale = false;
      saveSettings(next);
      return next;
    });
  }, []);

  const applyPreset = useCallback(
    (name: string) => {
      const p = PRESETS[name as keyof typeof PRESETS] as unknown as Settings;
      if (!p) return;
      const next = {
        ...s,
        metrics: [...p.metrics],
        xMode: p.xMode,
        maWindow: p.maWindow,
        normalize: p.normalize,
        uniqueGameDateOnly: p.uniqueGameDateOnly,
        separateScale: p.separateScale,
        lastPreset: name,
      };
      setS(next);
      saveSettings(next);
    },
    [s],
  );

  const filtered = useMemo(
    () => (s.uniqueGameDateOnly ? filterUniqueByDate(records) : records),
    [records, s.uniqueGameDateOnly],
  );
  const { xValues, xTitle } = useMemo(
    () => buildXAxis(filtered, s.xMode),
    [filtered, s.xMode],
  );

  const shouldSep = useMemo(() => {
    if (s.normalize) return false;
    if (s.separateScale) return true;
    if (!s.autoScale || s.metrics.length <= 1) return false;
    const ranges = s.metrics
      .map((m) => {
        const vs = filtered
          .map((r) => r[m as keyof SaveRecord] as number | null)
          .filter((v): v is number => v != null && isFinite(v));
        if (!vs.length) return null;
        return Math.max(...vs) - Math.min(...vs);
      })
      .filter((v): v is number => v !== null && v > 0);
    return (
      ranges.length >= 2 &&
      Math.max(...ranges) / Math.max(Math.min(...ranges), 0.0001) >= 20
    );
  }, [s, filtered]);

  const traces = useMemo(
    () =>
      s.metrics.flatMap((metric, idx) => {
        const pts = filtered
          .map((rec, i) => {
            const v = rec[metric as keyof SaveRecord] as number | null;
            return v != null && isFinite(v) ? { x: xValues[i], y: v } : null;
          })
          .filter(Boolean) as { x: string | number; y: number }[];
        if (!pts.length) return [];
        let ys = movingAverage(
          pts.map((p) => p.y),
          s.maWindow,
        );
        if (s.normalize) ys = normalizeSeries(ys);
        return [
          {
            type: "scattergl" as const,
            mode: "lines+markers" as const,
            name: metric,
            x: pts.map((p) => p.x),
            y: ys,
            yaxis: shouldSep ? (idx === 0 ? "y" : `y${idx + 1}`) : "y",
            line: { width: 2.5 },
            marker: { size: 6 },
            hovertemplate: `<b>${metric}</b><br>%{x}<br>%{y:.3f}<extra></extra>`,
          },
        ];
      }),
    [s, filtered, xValues, shouldSep],
  );

  const layout = useMemo(() => {
    const l: Record<string, unknown> = {
      ...BASE,
      hovermode: "closest",
      legend: { orientation: "h", y: 1.12, x: 0 },
      xaxis: {
        title: xTitle,
        gridcolor: "rgba(23,34,38,0.08)",
        zeroline: false,
        tickangle: -25,
      },
      yaxis: {
        title: s.normalize ? "Normalized" : "Metric value",
        gridcolor: "rgba(23,34,38,0.08)",
        zeroline: false,
      },
    };
    if (shouldSep)
      s.metrics.forEach((m, i) => {
        if (i === 0) return;
        l[`yaxis${i + 1}`] = {
          title: m,
          overlaying: "y",
          side: i % 2 === 1 ? "right" : "left",
          showgrid: false,
          zeroline: false,
        };
      });
    return l;
  }, [xTitle, s, shouldSep, BASE]);

  return (
    <div className="layout-grid">
      <aside className="side-column">
        <section className="panel">
          <div className="panel-head">
            <h2>Presets</h2>
            <div className="micro-copy">One click</div>
          </div>
          <div className="preset-list">
            {Object.entries(PRESETS).map(([name, p]) => (
              <button
                key={name}
                className={`preset-card${s.lastPreset === name ? " active" : ""}`}
                onClick={() => applyPreset(name)}
              >
                <div className="preset-head">
                  <div className="preset-title">{name}</div>
                  <div className="preset-tag">{p.metrics.length} metrics</div>
                </div>
                <p>{p.description}</p>
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Metrics</h2>
          </div>
          <div className="metric-list">
            {NUMERIC_METRICS.map((m) => (
              <label key={m} className="metric-chip">
                <input
                  type="checkbox"
                  checked={s.metrics.includes(m)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...s.metrics, m]
                      : s.metrics.filter((x) => x !== m);
                    update({ metrics: next, lastPreset: "" });
                  }}
                />
                <span>{m}</span>
              </label>
            ))}
          </div>
        </section>
      </aside>
      <main className="main-column">
        <section className="panel chart-panel">
          <div className="panel-head">
            <h2>Chart</h2>
            <div className="micro-copy">
              {traces.length} metrics · {filtered.length} records · MA=
              {s.maWindow}
            </div>
          </div>
          <Suspense
            fallback={
              <div
                style={{
                  minHeight: 520,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                Loading chart…
              </div>
            }
          >
            <Plot
              data={traces}
              layout={layout}
              config={{ responsive: true, displaylogo: false }}
              style={{ width: "100%", minHeight: 520 }}
            />
          </Suspense>
        </section>
        <section className="detail-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>Recent Saves</h2>
            </div>
            <div className="table-wrap">
              <table className="recent-table">
                <thead>
                  <tr>
                    <th>Game date</th>
                    <th>Write s</th>
                    <th>CPU avg</th>
                    <th>RAM avg</th>
                    <th>Divs</th>
                  </tr>
                </thead>
                <tbody>
                  {[...records]
                    .reverse()
                    .slice(0, 8)
                    .map((r, i) => (
                      <tr key={i}>
                        <td>{r.game_date ?? "—"}</td>
                        <td>{r.write_duration_seconds?.toFixed(2)}</td>
                        <td>{r.cpu_avg?.toFixed(1)}</td>
                        <td>{r.ram_avg?.toFixed(0)}</td>
                        <td>{r.divisions}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Controls</h2>
            </div>
            <div className="controls-grid">
              <label className="field">
                <span>X-axis</span>
                <select
                  value={s.xMode}
                  onChange={(e) => update({ xMode: e.target.value as XMode })}
                >
                  {["save_index", "real_time", "game_date"].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Moving avg</span>
                <input
                  type="range"
                  min={1}
                  max={12}
                  value={s.maWindow}
                  onChange={(e) =>
                    update({ maWindow: parseInt(e.target.value) })
                  }
                />
                <strong>{s.maWindow}</strong>
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={s.normalize}
                  onChange={(e) => update({ normalize: e.target.checked })}
                />
                <span>Normalize 0..1</span>
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={s.uniqueGameDateOnly}
                  onChange={(e) =>
                    update({ uniqueGameDateOnly: e.target.checked })
                  }
                />
                <span>Unique game dates</span>
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={s.separateScale}
                  onChange={(e) => update({ separateScale: e.target.checked })}
                />
                <span>Separate Y scales</span>
              </label>
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
