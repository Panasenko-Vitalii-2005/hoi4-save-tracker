const NUMERIC_METRICS = [
  "file_size_mb",
  "write_duration_seconds",
  "write_speed_mb_per_sec",
  "cpu_avg",
  "cpu_max",
  "ram_avg",
  "ram_max",
  "resource_samples",
  "divisions",
  "army_groups",
  "ships",
  "planes",
  "active_countries",
  "parse_seconds",
  "interval_seconds",
  "game_days_passed",
  "seconds_per_game_day",
];

const X_MODES = ["save_index", "real_time", "game_date"];

const PRESETS = {
  Performance: {
    metrics: [
      "write_duration_seconds",
      "write_speed_mb_per_sec",
      "parse_seconds",
    ],
    xMode: "real_time",
    maWindow: 1,
    normalize: false,
    uniqueGameDateOnly: true,
    separateScale: false,
    description: "Save/write/parse timing over real time.",
  },
  "System Load": {
    metrics: ["cpu_avg", "cpu_max", "ram_avg", "ram_max", "resource_samples"],
    xMode: "real_time",
    maWindow: 2,
    normalize: false,
    uniqueGameDateOnly: true,
    separateScale: true,
    description: "CPU and RAM behavior during save writes.",
  },
  "Military Growth": {
    metrics: [
      "divisions",
      "army_groups",
      "ships",
      "planes",
      "active_countries",
    ],
    xMode: "game_date",
    maWindow: 1,
    normalize: false,
    uniqueGameDateOnly: true,
    separateScale: true,
    description: "In-game force growth by game date.",
  },
  "Compare Trends": {
    metrics: [
      "write_duration_seconds",
      "cpu_avg",
      "ram_avg",
      "divisions",
      "ships",
      "planes",
    ],
    xMode: "game_date",
    maWindow: 3,
    normalize: true,
    uniqueGameDateOnly: true,
    separateScale: false,
    description: "Normalized multi-metric trend comparison.",
  },
  "Duplicate Finder": {
    metrics: [
      "write_duration_seconds",
      "file_size_mb",
      "write_speed_mb_per_sec",
    ],
    xMode: "real_time",
    maWindow: 1,
    normalize: false,
    uniqueGameDateOnly: false,
    separateScale: false,
    description: "Keep duplicate game_date records visible for diagnostics.",
  },
};

const DEFAULT_STATE = {
  xMode: "save_index",
  maWindow: 1,
  normalize: false,
  uniqueGameDateOnly: false,
  separateScale: false,
  autoScale: true,
  metrics: ["write_duration_seconds", "cpu_avg", "ram_avg"],
  lastPreset: "",
};

const STORAGE_KEY = "hoi4-autosave-web-settings-v1";

const state = {
  records: [],
  filteredRecords: [],
  focusedRecord: null,
  ...loadSettings(),
};

const els = {
  summaryGrid: document.getElementById("summaryGrid"),
  statusPill: document.getElementById("statusPill"),
  chartMeta: document.getElementById("chartMeta"),
  chart: document.getElementById("chart"),
  presetList: document.getElementById("presetList"),
  metricList: document.getElementById("metricList"),
  recordDetails: document.getElementById("recordDetails"),
  recentTableBody: document.getElementById("recentTableBody"),
  reloadBtn: document.getElementById("reloadBtn"),
  exportBtn: document.getElementById("exportBtn"),
  xModeSelect: document.getElementById("xModeSelect"),
  maInput: document.getElementById("maInput"),
  maValue: document.getElementById("maValue"),
  normalizeToggle: document.getElementById("normalizeToggle"),
  uniqueDateToggle: document.getElementById("uniqueDateToggle"),
  separateScaleToggle: document.getElementById("separateScaleToggle"),
  autoScaleToggle: document.getElementById("autoScaleToggle"),
};

init();

async function init() {
  buildControls();
  bindEvents();
  renderPresets();
  renderMetricList();
  await loadRecords();
}

function buildControls() {
  els.xModeSelect.innerHTML = X_MODES.map(
    (mode) => `<option value="${mode}">${mode}</option>`,
  ).join("");
  els.xModeSelect.value = state.xMode;
  els.maInput.value = String(state.maWindow);
  els.maValue.textContent = String(state.maWindow);
  els.normalizeToggle.checked = state.normalize;
  els.uniqueDateToggle.checked = state.uniqueGameDateOnly;
  els.separateScaleToggle.checked = state.separateScale;
  els.autoScaleToggle.checked = state.autoScale;
}

function bindEvents() {
  els.reloadBtn.addEventListener("click", loadRecords);
  els.exportBtn.addEventListener("click", () =>
    Plotly.downloadImage(els.chart, {
      format: "png",
      filename: "hoi4_autosave_dashboard",
      scale: 2,
    }),
  );
  els.xModeSelect.addEventListener("change", () =>
    updateState({ xMode: els.xModeSelect.value }),
  );
  els.maInput.addEventListener("input", () => {
    els.maValue.textContent = els.maInput.value;
    updateState({ maWindow: Number(els.maInput.value) });
  });
  els.normalizeToggle.addEventListener("change", () =>
    updateState({ normalize: els.normalizeToggle.checked }),
  );
  els.uniqueDateToggle.addEventListener("change", () =>
    updateState({ uniqueGameDateOnly: els.uniqueDateToggle.checked }),
  );
  els.separateScaleToggle.addEventListener("change", () =>
    updateState({ separateScale: els.separateScaleToggle.checked }),
  );
  els.autoScaleToggle.addEventListener("change", () =>
    updateState({ autoScale: els.autoScaleToggle.checked }),
  );
  window.addEventListener("resize", debounce(renderChart, 80));
}

async function loadRecords() {
  setStatus("Loading", true);
  try {
    const response = await fetch(`/api/records?ts=${Date.now()}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    state.records = Array.isArray(payload.records) ? payload.records : [];
    state.focusedRecord = state.records.at(-1) || null;
    renderAll();
    setStatus(`${state.records.length} records loaded`, false);
  } catch (error) {
    console.error(error);
    state.records = [];
    state.filteredRecords = [];
    renderAll();
    setStatus(error.message || "Failed to load data", true);
  }
}

function renderAll() {
  state.filteredRecords = getFilteredRecords();
  renderSummary();
  renderRecentTable();
  renderDetails(state.focusedRecord || state.filteredRecords.at(-1) || null);
  renderPresets();
  renderMetricList();
  renderChart();
  saveSettings();
}

function updateState(partial) {
  Object.assign(state, partial);
  if (state.normalize) {
    state.separateScale = false;
    els.separateScaleToggle.checked = false;
  }
  renderAll();
}

function renderSummary() {
  const latest = state.filteredRecords.at(-1) || state.records.at(-1);
  const total = state.filteredRecords.length;
  const avgWrite = average(
    state.filteredRecords.map((r) => numberOrNull(r.write_duration_seconds)),
  );
  const avgCpu = average(
    state.filteredRecords.map((r) => numberOrNull(r.cpu_avg)),
  );
  const latestDate = latest?.game_date || "—";
  const latestSize = formatNumber(latest?.file_size_mb);

  const cards = [
    {
      label: "Visible saves",
      value: total,
      sub: `${state.records.length} total in file`,
    },
    {
      label: "Latest game date",
      value: latestDate,
      sub: `save size ${latestSize} MB`,
    },
    {
      label: "Avg write time",
      value: formatNumber(avgWrite),
      sub: "seconds across visible records",
    },
    {
      label: "Avg CPU",
      value: formatNumber(avgCpu),
      sub: "average save-time process usage",
    },
  ];

  els.summaryGrid.innerHTML = cards
    .map(
      (card) => `
    <article class="summary-card">
      <div class="summary-label">${escapeHtml(String(card.label))}</div>
      <div class="summary-value">${escapeHtml(String(card.value))}</div>
      <div class="summary-sub">${escapeHtml(String(card.sub))}</div>
    </article>
  `,
    )
    .join("");
}

function renderPresets() {
  els.presetList.innerHTML = Object.entries(PRESETS)
    .map(([name, preset]) => {
      const active = state.lastPreset === name ? "active" : "";
      return `
      <button class="preset-card ${active}" data-preset="${escapeHtml(name)}">
        <div class="preset-head">
          <div class="preset-title">${escapeHtml(name)}</div>
          <div class="preset-tag">${preset.metrics.length} metrics</div>
        </div>
        <p>${escapeHtml(preset.description)}</p>
      </button>
    `;
    })
    .join("");

  els.presetList.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });
}

function renderMetricList() {
  els.metricList.innerHTML = NUMERIC_METRICS.map(
    (metric) => `
    <label class="metric-chip">
      <input type="checkbox" value="${metric}" ${state.metrics.includes(metric) ? "checked" : ""}>
      <span>${escapeHtml(metric)}</span>
    </label>
  `,
  ).join("");

  els.metricList.querySelectorAll("input[type=checkbox]").forEach((input) => {
    input.addEventListener("change", () => {
      const metrics = Array.from(
        els.metricList.querySelectorAll("input:checked"),
      ).map((node) => node.value);
      updateState({ metrics, lastPreset: "" });
    });
  });
}

function renderRecentTable() {
  const rows = state.filteredRecords.slice(-8).reverse();
  els.recentTableBody.innerHTML = rows
    .map(
      (record) => `
    <tr>
      <td>${escapeHtml(record.game_date || "—")}</td>
      <td>${escapeHtml(formatNumber(record.write_duration_seconds))}</td>
      <td>${escapeHtml(formatNumber(record.cpu_avg))}</td>
      <td>${escapeHtml(formatNumber(record.ram_avg))}</td>
      <td>${escapeHtml(formatNumber(record.divisions, 0))}</td>
    </tr>
  `,
    )
    .join("");
}

function renderDetails(record) {
  if (!record) {
    els.recordDetails.innerHTML = `<div class="micro-copy">No record selected.</div>`;
    return;
  }

  const rows = [
    ["real_time", record.real_time],
    ["game_date", record.game_date],
    ["write_duration_seconds", record.write_duration_seconds],
    ["write_speed_mb_per_sec", record.write_speed_mb_per_sec],
    ["cpu_avg", record.cpu_avg],
    ["cpu_max", record.cpu_max],
    ["ram_avg", record.ram_avg],
    ["divisions", record.divisions],
    ["ships", record.ships],
    ["planes", record.planes],
    ["active_countries", record.active_countries],
    ["seconds_per_game_day", record.seconds_per_game_day],
  ];

  els.recordDetails.innerHTML = rows
    .map(
      ([key, value]) => `
    <div class="record-row">
      <div class="record-key">${escapeHtml(String(key))}</div>
      <div class="record-value">${escapeHtml(formatAny(value))}</div>
    </div>
  `,
    )
    .join("");
}

function renderChart() {
  const records = state.filteredRecords;
  const metrics = state.metrics.filter((metric) =>
    NUMERIC_METRICS.includes(metric),
  );
  const normalize = state.normalize;
  const separateScale = !normalize && resolveSeparateScale(records, metrics);
  const { xValues, xLabels, xTitle } = buildXAxis(records, state.xMode);
  const traces = [];
  const layout = buildBaseLayout(xTitle);

  if (!records.length || !metrics.length) {
    Plotly.react(els.chart, [], layout, {
      responsive: true,
      displaylogo: false,
    });
    els.chartMeta.textContent = "No records or metrics selected";
    return;
  }

  metrics.forEach((metric, index) => {
    const points = records
      .map((record, rowIndex) => {
        const value = numberOrNull(record[metric]);
        return value === null
          ? null
          : { record, value, x: xValues[rowIndex], label: xLabels[rowIndex] };
      })
      .filter(Boolean);

    if (!points.length) {
      return;
    }

    const smoothed = movingAverage(
      points.map((point) => point.value),
      state.maWindow,
    );
    const displayValues = normalize ? normalizeSeries(smoothed) : smoothed;
    const axisName = separateScale ? `y${index + 1}` : "y";

    if (separateScale) {
      const axisKey = index === 0 ? "yaxis" : `yaxis${index + 1}`;
      layout[axisKey] = buildYAxis(metric, index, index === 0);
    }

    traces.push({
      type: "scattergl",
      mode: "lines+markers",
      name: metric,
      x: points.map((point) => point.x),
      y: displayValues,
      yaxis: axisName,
      line: { width: 3 },
      marker: { size: 8 },
      customdata: points.map((point, idx) => [
        point.record.real_time || "—",
        point.record.game_date || "—",
        point.value,
        displayValues[idx],
        point.record.file_size_mb,
        point.record.write_duration_seconds,
        point.record.divisions,
        point.record.ships,
        point.record.planes,
        JSON.stringify(point.record),
      ]),
      hovertemplate: [
        `<b>${metric}</b>`,
        `Game date: %{customdata[1]}`,
        `Real time: %{customdata[0]}`,
        `Value: %{customdata[2]:.3f}`,
        normalize ? `Plot value: %{customdata[3]:.3f}` : null,
        `Write s: %{customdata[5]:.2f}`,
        `File MB: %{customdata[4]:.2f}`,
        `<extra></extra>`,
      ]
        .filter(Boolean)
        .join("<br>"),
    });
  });

  if (!traces.length) {
    Plotly.react(els.chart, [], layout, {
      responsive: true,
      displaylogo: false,
    });
    els.chartMeta.textContent = "Selected metrics have no numeric data";
    return;
  }

  Plotly.react(els.chart, traces, layout, {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
  });

  els.chartMeta.textContent = `${traces.length} metric(s), ${records.length} visible record(s), x=${state.xMode}, MA=${state.maWindow}${normalize ? ", normalized" : ""}${separateScale ? ", separate scales" : ""}`;

  els.chart.on("plotly_hover", (eventData) => {
    const raw = eventData?.points?.[0]?.customdata?.[9];
    if (!raw) {
      return;
    }
    try {
      const record = JSON.parse(raw);
      state.focusedRecord = record;
      renderDetails(record);
    } catch {
      return;
    }
  });

  els.chart.on("plotly_click", (eventData) => {
    const raw = eventData?.points?.[0]?.customdata?.[9];
    if (!raw) {
      return;
    }
    try {
      const record = JSON.parse(raw);
      state.focusedRecord = record;
      renderDetails(record);
    } catch {
      return;
    }
  });
}

function buildBaseLayout(xTitle) {
  return {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(255,252,247,0.72)",
    margin: { l: 72, r: 88, t: 20, b: 80 },
    font: { family: "Space Grotesk, sans-serif", color: "#172226" },
    hoverlabel: {
      bgcolor: "#fff9ef",
      bordercolor: "#d94f2b",
      font: { family: "IBM Plex Mono, monospace", color: "#172226" },
    },
    hovermode: "closest",
    legend: { orientation: "h", y: 1.12, x: 0 },
    xaxis: {
      title: xTitle,
      gridcolor: "rgba(23,34,38,0.08)",
      zeroline: false,
      tickangle: -25,
    },
    yaxis: {
      title: state.normalize ? "Normalized value" : "Metric value",
      gridcolor: "rgba(23,34,38,0.08)",
      zeroline: false,
    },
  };
}

function buildYAxis(metric, index, isPrimary) {
  const axis = {
    title: metric,
    zeroline: false,
    gridcolor: isPrimary ? "rgba(23,34,38,0.08)" : "rgba(0,0,0,0)",
  };
  if (!isPrimary) {
    axis.overlaying = "y";
    axis.side = index % 2 === 1 ? "right" : "left";
    axis.position = index % 2 === 1 ? 1 : Math.max(0.05, 0.04 * index);
  }
  return axis;
}

function resolveSeparateScale(records, metrics) {
  if (state.separateScale) {
    return true;
  }
  if (!state.autoScale || metrics.length <= 1) {
    return false;
  }
  const ranges = metrics
    .map((metric) => {
      const values = records
        .map((record) => numberOrNull(record[metric]))
        .filter((value) => value !== null);
      if (!values.length) {
        return null;
      }
      return Math.max(...values) - Math.min(...values);
    })
    .filter((value) => value !== null && value > 0);
  if (ranges.length < 2) {
    return false;
  }
  const maxRange = Math.max(...ranges);
  const minRange = Math.min(...ranges);
  return maxRange / Math.max(minRange, 0.0001) >= 20;
}

function getFilteredRecords() {
  if (!state.uniqueGameDateOnly) {
    return [...state.records];
  }
  const byDate = new Map();
  const noDate = [];
  state.records.forEach((record) => {
    if (!record.game_date) {
      noDate.push(record);
      return;
    }
    byDate.set(record.game_date, record);
  });
  const dated = Array.from(byDate.values()).sort((a, b) =>
    String(a.real_time || "").localeCompare(String(b.real_time || "")),
  );
  return [...noDate, ...dated];
}

function buildXAxis(records, mode) {
  if (mode === "save_index") {
    return {
      xValues: records.map((_, index) => index + 1),
      xLabels: records.map((_, index) => String(index + 1)),
      xTitle: "Save index",
    };
  }
  if (mode === "real_time") {
    return {
      xValues: records.map(
        (record, index) => record.real_time || String(index + 1),
      ),
      xLabels: records.map(
        (record, index) => record.real_time || String(index + 1),
      ),
      xTitle: "Real time",
    };
  }
  return {
    xValues: records.map(
      (record, index) => record.game_date || String(index + 1),
    ),
    xLabels: records.map(
      (record, index) => record.game_date || String(index + 1),
    ),
    xTitle: "Game date",
  };
}

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) {
    return;
  }
  updateState({
    metrics: [...preset.metrics],
    xMode: preset.xMode,
    maWindow: preset.maWindow,
    normalize: preset.normalize,
    uniqueGameDateOnly: preset.uniqueGameDateOnly,
    separateScale: preset.separateScale,
    lastPreset: name,
  });
  buildControls();
}

function movingAverage(values, window) {
  if (window <= 1) {
    return [...values];
  }
  const out = [];
  let rolling = 0;
  values.forEach((value, index) => {
    rolling += value;
    if (index >= window) {
      rolling -= values[index - window];
    }
    out.push(rolling / Math.min(window, index + 1));
  });
  return out;
}

function normalizeSeries(values) {
  if (!values.length) {
    return values;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) {
    return values.map(() => 0.5);
  }
  return values.map((value) => (value - min) / (max - min));
}

function average(values) {
  const clean = values.filter((value) => value !== null);
  if (!clean.length) {
    return null;
  }
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return Number(value).toFixed(digits).replace(/\.00$/, "");
}

function formatAny(value) {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "number") {
    return formatNumber(value, 2);
  }
  return String(value);
}

function setStatus(text, isError) {
  els.statusPill.textContent = text;
  els.statusPill.style.background = isError
    ? "rgba(217, 79, 43, 0.12)"
    : "rgba(11, 122, 117, 0.12)";
  els.statusPill.style.color = isError ? "#d94f2b" : "#0b7a75";
}

function saveSettings() {
  const payload = {
    xMode: state.xMode,
    maWindow: state.maWindow,
    normalize: state.normalize,
    uniqueGameDateOnly: state.uniqueGameDateOnly,
    separateScale: state.separateScale,
    autoScale: state.autoScale,
    metrics: state.metrics,
    lastPreset: state.lastPreset,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_STATE };
    }
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function debounce(fn, delay) {
  let timeoutId = null;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
