/* soldiers.js — Soldiers by Country tab logic */

const soldiersState = {
  data: null, // full API response
  topN: 10,
  uniqueDate: true,
  selectedTag: null,
};

// ── Init ────────────────────────────────────────────────────────────────────

(function initSoldiers() {
  // Wire tab switching
  document.getElementById("mainTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;

    document
      .querySelectorAll(".tab-btn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    const tab = btn.dataset.tab;
    document.getElementById("tabChart").style.display =
      tab === "chart" ? "" : "none";
    document.getElementById("tabSoldiers").style.display =
      tab === "soldiers" ? "" : "none";

    if (tab === "soldiers" && !soldiersState.data) {
      loadSoldiersData();
    }
  });

  // Controls
  document.getElementById("soldiersTopN").addEventListener("input", (e) => {
    soldiersState.topN = Math.max(1, parseInt(e.target.value, 10) || 10);
    if (soldiersState.data) {
      renderSoldiersChart();
    }
  });

  document
    .getElementById("soldiersUniqueDateToggle")
    .addEventListener("change", (e) => {
      soldiersState.uniqueDate = e.target.checked;
      if (soldiersState.data) {
        renderSoldiersChart();
        if (soldiersState.selectedTag) {
          renderSoldiersDetailChart(soldiersState.selectedTag);
        }
      }
    });
})();

// ── Data loading ────────────────────────────────────────────────────────────

async function loadSoldiersData() {
  document.getElementById("soldiersRankBody").innerHTML =
    `<tr><td colspan="5" style="color:var(--muted);padding:16px">Loading…</td></tr>`;

  try {
    const resp = await fetch(`/api/soldiers?ts=${Date.now()}`);
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
    soldiersState.data = json;
    renderSoldiersRanking();
    renderSoldiersChart();
  } catch (err) {
    document.getElementById("soldiersRankBody").innerHTML =
      `<tr><td colspan="5" style="color:var(--accent);padding:16px">${escHtml(err.message)}</td></tr>`;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function filteredTimeline() {
  const timeline = soldiersState.data?.timeline ?? [];
  if (!soldiersState.uniqueDate) return timeline;

  const seen = new Set();
  const out = [];
  for (const entry of timeline) {
    const key = entry.game_date || entry.real_time || "";
    if (!seen.has(key)) {
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
}

function getTopNTags() {
  const latest = soldiersState.data?.latest_ranked ?? [];
  return latest.slice(0, soldiersState.topN).map((r) => r.tag);
}

function escHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtNum(v, digits = 0) {
  if (v === null || v === undefined || isNaN(v)) return "—";
  return Number(v).toLocaleString("en", { maximumFractionDigits: digits });
}

// ── Ranking table ────────────────────────────────────────────────────────────

function renderSoldiersRanking() {
  const ranked = soldiersState.data?.latest_ranked ?? [];
  const tbody = document.getElementById("soldiersRankBody");

  if (!ranked.length) {
    tbody.innerHTML =
      `<tr><td colspan="5" style="color:var(--muted);padding:16px">` +
      `No soldiers_by_country data in records yet.<br>` +
      `Run the tracker to collect new saves.</td></tr>`;
    return;
  }

  tbody.innerHTML = ranked
    .map(
      (row, idx) => `
    <tr class="soldiers-rank-row" data-tag="${escHtml(row.tag)}" style="cursor:pointer">
      <td>${idx + 1}</td>
      <td><strong>${escHtml(row.tag)}</strong></td>
      <td>${fmtNum(row.divisions)}</td>
      <td>${fmtNum(row.manpower)}</td>
      <td>${fmtNum(row.avg_manpower, 1)}</td>
    </tr>
  `,
    )
    .join("");

  tbody.querySelectorAll(".soldiers-rank-row").forEach((tr) => {
    tr.addEventListener("click", () => {
      const tag = tr.dataset.tag;
      tbody
        .querySelectorAll(".soldiers-rank-row")
        .forEach((r) => r.classList.remove("selected"));
      tr.classList.add("selected");
      soldiersState.selectedTag = tag;
      renderSoldiersDetailChart(tag);
    });
  });
}

// ── Top-N stacked area chart ─────────────────────────────────────────────────

function renderSoldiersChart() {
  const topTags = getTopNTags();
  const timeline = filteredTimeline();
  const chartEl = document.getElementById("soldiersChart");

  if (!topTags.length || !timeline.length) {
    Plotly.react(
      chartEl,
      [],
      {
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(255,252,247,0.72)",
      },
      { responsive: true },
    );
    return;
  }

  const xLabels = timeline.map((e) => e.game_date || e.real_time || "");

  const traces = topTags.map((tag) => ({
    type: "scatter",
    mode: "lines",
    name: tag,
    stackgroup: "one",
    x: xLabels,
    y: timeline.map((e) => e[tag]?.manpower ?? 0),
    hovertemplate: `<b>${escHtml(tag)}</b><br>Date: %{x}<br>Manpower: %{y:,.0f}<extra></extra>`,
    line: { width: 1.5 },
  }));

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(255,252,247,0.72)",
    margin: { l: 64, r: 20, t: 10, b: 60 },
    font: { family: "Space Grotesk, sans-serif", color: "#172226" },
    hovermode: "x unified",
    legend: { orientation: "h", y: 1.08 },
    xaxis: {
      title: "Game date",
      tickangle: -25,
      gridcolor: "rgba(23,34,38,0.08)",
    },
    yaxis: { title: "Total manpower", gridcolor: "rgba(23,34,38,0.08)" },
    hoverlabel: {
      bgcolor: "#fff9ef",
      bordercolor: "#d94f2b",
      font: { family: "IBM Plex Mono, monospace", color: "#172226" },
    },
  };

  Plotly.react(chartEl, traces, layout, {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  });
}

// ── Single-country detail chart ──────────────────────────────────────────────

function renderSoldiersDetailChart(tag) {
  const timeline = filteredTimeline();
  const chartEl = document.getElementById("soldiersDetailChart");

  const xLabels = timeline.map((e) => e.game_date || e.real_time || "");
  const strength = timeline.map((e) => e[tag]?.manpower ?? 0);
  const divisions = timeline.map((e) => e[tag]?.divisions ?? 0);
  const avgStrength = timeline.map((e) => e[tag]?.avg_manpower ?? 0);

  const traces = [
    {
      type: "scatter",
      mode: "lines+markers",
      name: "Manpower",
      x: xLabels,
      y: strength,
      line: { width: 2.5 },
      marker: { size: 5 },
      hovertemplate: "Manpower: %{y:,.0f}<extra></extra>",
    },
    {
      type: "scatter",
      mode: "lines+markers",
      name: "Divisions",
      x: xLabels,
      y: divisions,
      yaxis: "y2",
      line: { width: 1.5, dash: "dot" },
      marker: { size: 4 },
      hovertemplate: "Divisions: %{y}<extra></extra>",
    },
    {
      type: "scatter",
      mode: "lines",
      name: "Avg manpower / div",
      x: xLabels,
      y: avgStrength,
      yaxis: "y3",
      line: { width: 1.5, dash: "dash" },
      hovertemplate: "Avg manpower: %{y:.1f}<extra></extra>",
    },
  ];

  const layout = {
    title: { text: `${tag} — manpower timeline`, font: { size: 16 } },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(255,252,247,0.72)",
    margin: { l: 64, r: 80, t: 36, b: 60 },
    font: { family: "Space Grotesk, sans-serif", color: "#172226" },
    hovermode: "x unified",
    legend: { orientation: "h", y: 1.12 },
    xaxis: {
      title: "Game date",
      tickangle: -25,
      gridcolor: "rgba(23,34,38,0.08)",
    },
    yaxis: { title: "Manpower", gridcolor: "rgba(23,34,38,0.08)" },
    yaxis2: {
      title: "Divisions",
      overlaying: "y",
      side: "right",
      gridcolor: "rgba(0,0,0,0)",
      showgrid: false,
    },
    yaxis3: {
      title: "Avg str / div",
      overlaying: "y",
      side: "right",
      position: 1,
      anchor: "free",
      gridcolor: "rgba(0,0,0,0)",
      showgrid: false,
    },
    hoverlabel: {
      bgcolor: "#fff9ef",
      bordercolor: "#d94f2b",
      font: { family: "IBM Plex Mono, monospace", color: "#172226" },
    },
  };

  Plotly.react(chartEl, traces, layout, {
    responsive: true,
    displaylogo: false,
  });
}
