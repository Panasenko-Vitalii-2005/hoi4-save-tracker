/* analyzer.js — Save Analyzer tab */

const analyzerState = {
  result: null,
  sortCol: "manpower",
  sortAsc: false,
  filter: "",
  showEquipment: false,
  eqCountry: null,
};

const BASE_LAYOUT = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(255,252,247,0.72)",
  margin: { l: 90, r: 20, t: 10, b: 40 },
  font: { family: "Space Grotesk, sans-serif", color: "#172226" },
  hoverlabel: {
    bgcolor: "#fff9ef",
    bordercolor: "#d94f2b",
    font: { family: "IBM Plex Mono, monospace", color: "#172226" },
  },
};

// ── Init ────────────────────────────────────────────────────

(function initAnalyzer() {
  // Tab switching handled in soldiers.js's listener; just add the panel behaviour
  document.getElementById("mainTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn || btn.dataset.tab !== "analyzer") return;
    const panel = document.getElementById("tabAnalyzer");
    panel.style.display = "";
    // restore path hint
    const input = document.getElementById("analyzerPath");
    if (!input.value) {
      input.placeholder =
        "C:\\Users\\panas\\OneDrive\\Документы\\Paradox Interactive\\Hearts of Iron IV\\save games\\autosave_temp.hoi4";
    }
  });

  document.getElementById("analyzerBtn").addEventListener("click", runAnalysis);

  document.getElementById("analyzerPath").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runAnalysis();
  });

  document.getElementById("analyzerFilter").addEventListener("input", (e) => {
    analyzerState.filter = e.target.value.trim().toUpperCase();
    if (analyzerState.result) renderTable();
  });

  // Column sorting
  document.getElementById("analyzerTable").addEventListener("click", (e) => {
    const th = e.target.closest("th.sortable");
    if (!th) return;
    const col = th.dataset.col;
    if (analyzerState.sortCol === col) {
      analyzerState.sortAsc = !analyzerState.sortAsc;
    } else {
      analyzerState.sortCol = col;
      analyzerState.sortAsc = col === "tag";
    }
    document
      .querySelectorAll("#analyzerTable thead th")
      .forEach((h) => h.classList.remove("sort-asc", "sort-desc"));
    th.classList.add(analyzerState.sortAsc ? "sort-asc" : "sort-desc");
    renderTable();
  });
})();

// ── Analysis request ─────────────────────────────────────────

async function runAnalysis() {
  const path = document.getElementById("analyzerPath").value.trim();
  if (!path) {
    setStatus("error", "Please enter the path to a .hoi4 save file.");
    return;
  }

  setStatus(
    "loading",
    '<span class="spinner"></span>Parsing save file… this may take 10–20 s',
  );
  document.getElementById("analyzerResults").style.display = "none";
  document.getElementById("analyzerBtn").disabled = true;

  try {
    const resp = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });

    // Read raw text first so we can show it if JSON parse fails
    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      const preview = text.slice(0, 200) || "(empty response)";
      throw new Error(
        `Server returned non-JSON (status ${resp.status}): ${preview}`,
      );
    }

    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

    analyzerState.result = data;
    renderAll(data);
    setStatus(
      "ok",
      `✓ Done in ${data.parse_seconds} s  ·  ${data.file_size_mb} MB  ·  ${data.game_date}`,
    );
  } catch (err) {
    setStatus("error", `✗ ${err.message}`);
  } finally {
    document.getElementById("analyzerBtn").disabled = false;
  }
}

// ── Render all ───────────────────────────────────────────────

function renderAll(data) {
  const results = document.getElementById("analyzerResults");
  results.style.display = "grid";
  renderSummary(data);
  renderMpChart(data);
  renderNavyChart(data);
  renderTable();
  setupEquipmentSection(data);
}

// Summary cards
function renderSummary(data) {
  const grid = document.getElementById("analyzerSummary");
  const fmt = (n) =>
    n >= 1_000_000
      ? (n / 1_000_000).toFixed(1) + "M"
      : n >= 1_000
        ? (n / 1_000).toFixed(1) + "K"
        : String(n);

  const cards = [
    {
      label: "Game date",
      value: data.game_date,
      sub: `${data.file_size_mb} MB file`,
    },
    {
      label: "Active countries",
      value: data.active_countries,
      sub: "states with an owner",
    },
    {
      label: "Total manpower",
      value: fmt(data.total_manpower),
      sub: `across ${data.total_divisions.toLocaleString()} divisions`,
    },
    {
      label: "Naval & Air",
      value: fmt(data.total_ships + data.total_planes),
      sub: `${data.total_ships.toLocaleString()} ships · ${data.total_planes.toLocaleString()} planes`,
    },
  ];

  grid.innerHTML = cards
    .map(
      (c) => `
    <article class="summary-card">
      <div class="summary-label">${c.label}</div>
      <div class="summary-value">${c.value}</div>
      <div class="summary-sub">${c.sub}</div>
    </article>`,
    )
    .join("");
}

// Manpower horizontal bar
function renderMpChart(data) {
  const rows = data.by_country.filter((r) => r.manpower > 0).slice(0, 30);
  const tags = rows.map((r) => r.tag).reverse();
  const mp = rows.map((r) => r.manpower).reverse();

  const colors = mp.map((v) => {
    const max = Math.max(...mp);
    const t = v / max;
    const r = Math.round(11 + (217 - 11) * t);
    const g = Math.round(122 + (79 - 122) * t);
    const b = Math.round(117 + (43 - 117) * t);
    return `rgb(${r},${g},${b})`;
  });

  const traces = [
    {
      type: "bar",
      orientation: "h",
      x: mp,
      y: tags,
      marker: { color: colors, opacity: 0.88 },
      hovertemplate: "<b>%{y}</b><br>Manpower: %{x:,.0f}<extra></extra>",
    },
  ];

  const layout = {
    ...BASE_LAYOUT,
    margin: { l: 56, r: 80, t: 8, b: 40 },
    xaxis: {
      title: "Manpower",
      gridcolor: "rgba(23,34,38,0.08)",
      tickformat: "~s",
    },
    yaxis: { tickfont: { family: "IBM Plex Mono, monospace", size: 12 } },
  };

  document.getElementById("analyzerMpMeta").textContent =
    `Top ${rows.length} of ${data.by_country.filter((r) => r.manpower > 0).length} countries`;

  Plotly.react("analyzerMpChart", traces, layout, {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  });
}

// Ships & planes grouped horizontal bar
function renderNavyChart(data) {
  const rows = data.by_country
    .filter((r) => r.ships > 0 || r.planes > 0)
    .sort((a, b) => b.ships + b.planes - (a.ships + a.planes))
    .slice(0, 25)
    .reverse();

  const tags = rows.map((r) => r.tag);
  const ships = rows.map((r) => r.ships);
  const planes = rows.map((r) => r.planes);

  const traces = [
    {
      type: "bar",
      orientation: "h",
      name: "Ships",
      x: ships,
      y: tags,
      marker: { color: "#0b7a75", opacity: 0.85 },
      hovertemplate: "<b>%{y}</b> ships: %{x:,}<extra></extra>",
    },
    {
      type: "bar",
      orientation: "h",
      name: "Planes",
      x: planes,
      y: tags,
      marker: { color: "#f2a93b", opacity: 0.85 },
      hovertemplate: "<b>%{y}</b> planes: %{x:,}<extra></extra>",
    },
  ];

  const layout = {
    ...BASE_LAYOUT,
    barmode: "stack",
    margin: { l: 56, r: 20, t: 8, b: 40 },
    legend: { orientation: "h", y: 1.08 },
    xaxis: {
      title: "Count",
      gridcolor: "rgba(23,34,38,0.08)",
      tickformat: "~s",
    },
    yaxis: { tickfont: { family: "IBM Plex Mono, monospace", size: 12 } },
  };

  Plotly.react("analyzerNavyChart", traces, layout, {
    responsive: true,
    displaylogo: false,
  });
}

// Full sortable / filterable table
function renderTable() {
  const data = analyzerState.result;
  if (!data) return;

  const { sortCol, sortAsc, filter } = analyzerState;

  let rows = data.by_country.filter((r) => !filter || r.tag.includes(filter));

  rows = [...rows].sort((a, b) => {
    const va = a[sortCol] ?? 0;
    const vb = b[sortCol] ?? 0;
    if (typeof va === "string")
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortAsc ? va - vb : vb - va;
  });

  const tbody = document.getElementById("analyzerTableBody");
  tbody.innerHTML = rows
    .map(
      (r, i) => `
    <tr>
      <td><span style="color:var(--muted);margin-right:8px">${i + 1}</span><strong>${r.tag}</strong></td>
      <td>${r.manpower ? r.manpower.toLocaleString() : "—"}</td>
      <td>${r.divisions ? r.divisions.toLocaleString() : "—"}</td>
      <td>${r.avg_manpower ? r.avg_manpower.toLocaleString() : "—"}</td>
      <td>${r.ships ? r.ships.toLocaleString() : "—"}</td>
      <td>${r.planes ? r.planes.toLocaleString() : "—"}</td>
    </tr>`,
    )
    .join("");

  document.getElementById("analyzerTableMeta").textContent =
    `${rows.length} of ${data.by_country.length} countries`;
}

// ── Helpers ──────────────────────────────────────────────────

function setStatus(type, html) {
  const el = document.getElementById("analyzerStatus");
  el.className = `analyzer-status ${type}`;
  el.innerHTML = html;
}
// ── Equipment section ───────────────────────────────────────────

function setupEquipmentSection(data) {
  const section = document.getElementById("analyzerEquipmentSection");
  const eqData = data.equipment_by_country || {};
  const countries = Object.keys(eqData).sort();

  if (!countries.length) {
    section.style.display = "none";
    return;
  }

  // Populate country selector
  const sel = document.getElementById("analyzerEqCountry");
  const prevCountry = analyzerState.eqCountry;
  sel.innerHTML = countries
    .map(
      (c) =>
        `<option value="${c}"${c === prevCountry ? " selected" : ""}>${c}</option>`,
    )
    .join("");

  const selectedCountry =
    prevCountry && countries.includes(prevCountry) ? prevCountry : countries[0];
  sel.value = selectedCountry;
  analyzerState.eqCountry = selectedCountry;

  sel.addEventListener("change", () => {
    analyzerState.eqCountry = sel.value;
    renderEquipmentCharts(data);
  });

  // Add toggle button to the table panel head if not yet added
  if (!document.getElementById("analyzerEqToggleBtn")) {
    const tablePanelHead = document.querySelector(
      "#analyzerResults .panel:last-of-type .panel-head",
    );
    if (tablePanelHead) {
      const btn = document.createElement("button");
      btn.id = "analyzerEqToggleBtn";
      btn.className = "button button-secondary";
      btn.style.cssText = "padding:8px 16px;font-size:14px";
      btn.textContent = "Show Equipment";
      btn.addEventListener("click", () => {
        analyzerState.showEquipment = !analyzerState.showEquipment;
        btn.textContent = analyzerState.showEquipment
          ? "Hide Equipment"
          : "Show Equipment";
        section.style.display = analyzerState.showEquipment ? "" : "none";
        if (analyzerState.showEquipment) {
          renderEquipmentCharts(analyzerState.result);
          section.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      tablePanelHead.appendChild(btn);
    }
  }

  // If already shown, re-render
  if (analyzerState.showEquipment) {
    section.style.display = "";
    renderEquipmentCharts(data);
  }
}

function renderEquipmentCharts(data) {
  const country = analyzerState.eqCountry;
  const eqData = (data.equipment_by_country || {})[country] || {};
  const worldEq = data.world_equipment || {};

  // Country equipment bar
  const entries = Object.entries(eqData).slice(0, 35);
  const eqNames = entries.map(([k]) => _shortEqName(k)).reverse();
  const eqCounts = entries.map(([, v]) => v).reverse();

  const maxVal = Math.max(...eqCounts, 1);
  const colors = eqCounts.map((v) => {
    const t = v / maxVal;
    return `rgba(${Math.round(11 + 206 * t)}, ${Math.round(122 - 43 * t)}, ${Math.round(117 - 74 * t)}, 0.85)`;
  });

  Plotly.react(
    "analyzerEqChart",
    [
      {
        type: "bar",
        orientation: "h",
        x: eqCounts,
        y: eqNames,
        marker: { color: colors },
        hovertemplate: "<b>%{y}</b><br>Amount: %{x:,.0f}<extra></extra>",
      },
    ],
    {
      ...BASE_LAYOUT,
      margin: { l: 180, r: 60, t: 10, b: 40 },
      title: { text: `${country} — equipment breakdown`, font: { size: 15 } },
      xaxis: {
        title: "Amount",
        gridcolor: "rgba(23,34,38,0.08)",
        tickformat: "~s",
      },
      yaxis: { tickfont: { family: "IBM Plex Mono, monospace", size: 11 } },
    },
    { responsive: true, displaylogo: false },
  );

  document.getElementById("analyzerEqMeta").textContent =
    `${entries.length} equipment types in ${country}'s army`;

  // World totals bar
  const worldEntries = Object.entries(worldEq).slice(0, 20);
  const wNames = worldEntries.map(([k]) => _shortEqName(k)).reverse();
  const wCounts = worldEntries.map(([, v]) => v).reverse();

  Plotly.react(
    "analyzerWorldEqChart",
    [
      {
        type: "bar",
        orientation: "h",
        x: wCounts,
        y: wNames,
        marker: { color: "rgba(11, 122, 117, 0.72)" },
        hovertemplate: "<b>%{y}</b><br>World total: %{x:,.0f}<extra></extra>",
      },
    ],
    {
      ...BASE_LAYOUT,
      margin: { l: 180, r: 20, t: 10, b: 40 },
      xaxis: {
        title: "World total",
        gridcolor: "rgba(23,34,38,0.08)",
        tickformat: "~s",
      },
      yaxis: { tickfont: { family: "IBM Plex Mono, monospace", size: 11 } },
    },
    { responsive: true, displaylogo: false },
  );
}

// Convert snake_case equipment name to readable short form
function _shortEqName(name) {
  return name
    .replace(/_equipment_/g, " eq ")
    .replace(/_/g, " ")
    .replace(/\b(\w)/g, (c) => c.toUpperCase());
}
