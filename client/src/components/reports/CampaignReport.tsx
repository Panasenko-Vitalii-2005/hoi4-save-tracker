import { useMemo } from "react";
import type {
  CampaignTrend,
  CampaignTrendSnapshot,
  CountryTrendMetrics,
} from "@/types/campaign-trends";
import {
  buildCampaignExport,
  campaignCsv,
  campaignExportFilename,
  prettyJson,
  type CampaignExportContext,
} from "@/lib/data-export";
import { countryFullName } from "@/lib/utils";
import { ReportMetric, ReportShell } from "./ReportShell";
import {
  finiteValues,
  formatReportDate,
  formatReportDelta,
  formatReportNumber,
} from "./report-utils";

type CampaignMetric = keyof CountryTrendMetrics;

const GROWTH_METRICS: readonly {
  key: CampaignMetric;
  label: string;
  compact?: boolean;
}[] = [
  { key: "divisions", label: "Divisions" },
  { key: "manpowerInField", label: "Manpower in field", compact: true },
  { key: "aircraft", label: "Aircraft", compact: true },
  { key: "ships", label: "Ships" },
  { key: "militaryFactories", label: "Military factories" },
  { key: "civilianFactories", label: "Civilian factories" },
  { key: "dockyards", label: "Dockyards" },
];

const CHART_METRICS = [
  { key: "militaryFactories" as const, label: "Military factories", className: "mil" },
  { key: "civilianFactories" as const, label: "Civilian factories", className: "civ" },
  { key: "dockyards" as const, label: "Dockyards", className: "dock" },
] as const;

function snapshotMetric(
  snapshot: CampaignTrendSnapshot,
  context: CampaignExportContext,
  metric: CampaignMetric,
): number | null {
  if (context.scope === "global") {
    if (metric === "calculatedCasualties") return null;
    return snapshot.metrics[metric] ?? null;
  }
  const country = snapshot.countries.find(
    ({ tag }) => tag === context.countryTag,
  );
  return country?.metrics[metric] ?? null;
}

function observedMaximum(
  snapshots: readonly CampaignTrendSnapshot[],
  context: CampaignExportContext,
  metric: CampaignMetric,
) {
  let maximum: { value: number; snapshot: CampaignTrendSnapshot } | null = null;
  for (const snapshot of snapshots) {
    const value = snapshotMetric(snapshot, context, metric);
    if (value !== null && Number.isFinite(value) && (!maximum || value > maximum.value))
      maximum = { value, snapshot };
  }
  return maximum;
}

function ReportIndustryChart({
  snapshots,
  context,
}: {
  snapshots: readonly CampaignTrendSnapshot[];
  context: CampaignExportContext;
}) {
  const width = 720;
  const height = 240;
  const padding = { top: 18, right: 18, bottom: 34, left: 54 };
  const values = CHART_METRICS.flatMap(({ key }) =>
    snapshots.map((snapshot) => snapshotMetric(snapshot, context, key)),
  );
  const maximum = Math.max(1, ...finiteValues(values));
  const x = (index: number) =>
    padding.left +
    (index / Math.max(1, snapshots.length - 1)) *
      (width - padding.left - padding.right);
  const y = (value: number) =>
    height -
    padding.bottom -
    (value / maximum) * (height - padding.top - padding.bottom);

  const segments = (metric: CampaignMetric) => {
    const result: string[] = [];
    let current: string[] = [];
    snapshots.forEach((snapshot, index) => {
      const value = snapshotMetric(snapshot, context, metric);
      if (value === null || !Number.isFinite(value)) {
        if (current.length) result.push(current.join(" "));
        current = [];
      } else current.push(`${x(index)},${y(value)}`);
    });
    if (current.length) result.push(current.join(" "));
    return result;
  };

  return (
    <figure className="report-chart">
      <figcaption>
        <strong>Observed industry snapshots</strong>
        <span>Raw values; missing snapshots remain gaps.</span>
      </figcaption>
      <div className="report-chart-legend" aria-hidden="true">
        {CHART_METRICS.map((metric) => (
          <span key={metric.key} className={metric.className}>{metric.label}</span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Industry chart across ${snapshots.length} snapshots. Maximum displayed value ${formatReportNumber(maximum)}.`}
      >
        <line
          className="report-chart-axis"
          x1={padding.left}
          x2={padding.left}
          y1={padding.top}
          y2={height - padding.bottom}
        />
        <line
          className="report-chart-axis"
          x1={padding.left}
          x2={width - padding.right}
          y1={height - padding.bottom}
          y2={height - padding.bottom}
        />
        <text x="4" y={padding.top + 4}>{formatReportNumber(maximum)}</text>
        <text x="4" y={height - padding.bottom + 4}>0</text>
        <text x={padding.left} y={height - 8}>{snapshots[0]?.gameDate ?? "—"}</text>
        <text
          x={width - padding.right}
          y={height - 8}
          textAnchor="end"
        >
          {snapshots.at(-1)?.gameDate ?? "—"}
        </text>
        {CHART_METRICS.flatMap((metric) =>
          segments(metric.key).map((points, index) => (
            <polyline
              key={`${metric.key}-${index}`}
              className={`report-chart-line ${metric.className}`}
              points={points}
            />
          )),
        )}
      </svg>
    </figure>
  );
}
export function CampaignReport({
  campaign,
  context,
  onBack,
}: {
  campaign: CampaignTrend;
  context: CampaignExportContext;
  onBack: () => void;
}) {
  const snapshots = campaign.snapshots;
  const first = snapshots[0] ?? null;
  const latest = snapshots.at(-1) ?? null;
  const scopeName =
    context.scope === "country" && context.countryTag
      ? countryFullName(context.countryTag)
      : "Global campaign";
  const campaignName = campaign.playerCountryTag
    ? `${countryFullName(campaign.playerCountryTag)} Campaign`
    : campaign.campaignId
      ? "Known Campaign"
      : "Legacy Campaign";
  const milestones = useMemo(
    () => [
      {
        label: "Highest observed military factories",
        result: observedMaximum(snapshots, context, "militaryFactories"),
      },
      {
        label: "Highest observed manpower",
        result: observedMaximum(snapshots, context, "manpowerInField"),
      },
      {
        label: "Highest observed divisions",
        result: observedMaximum(snapshots, context, "divisions"),
      },
    ],
    [context, snapshots],
  );
  const firstMil = first
    ? snapshotMetric(first, context, "militaryFactories")
    : null;
  const latestMil = latest
    ? snapshotMetric(latest, context, "militaryFactories")
    : null;
  const milChange =
    firstMil !== null && latestMil !== null ? latestMil - firstMil : null;

  return (
    <ReportShell
      eyebrow="Campaign report"
      title={campaignName}
      subtitle={`${formatReportDate(campaign.firstGameDate)} → ${formatReportDate(campaign.latestGameDate)}`}
      metadata={
        <>
          <span>{formatReportNumber(campaign.snapshotCount)} analyzed saves</span>
          <span>Report scope: {scopeName}</span>
          {campaign.campaignId && (
            <span title={campaign.campaignId}>
              Campaign {campaign.campaignId.slice(0, 8)}…{campaign.campaignId.slice(-4)}
            </span>
          )}
        </>
      }
      onBack={onBack}
      createCsv={() => ({
        content: campaignCsv(campaign, context),
        filename: campaignExportFilename(campaign, "csv"),
      })}
      createJson={() => ({
        content: prettyJson(buildCampaignExport(campaign, context)),
        filename: campaignExportFilename(campaign, "json"),
      })}
    >
      <section className="report-section report-introduction">
        <h2>Campaign summary</h2>
        <p>
          Across {formatReportNumber(campaign.snapshotCount)} analyzed saves,
          military factories changed from {formatReportNumber(firstMil)} to{" "}
          {formatReportNumber(latestMil)} ({formatReportDelta(milChange)}).
          Values are direct observations from stored snapshots.
        </p>
      </section>

      <section className="report-section" aria-labelledby="campaign-overview-title">
        <div className="report-section-heading">
          <div>
            <span className="eyebrow">Stored history</span>
            <h2 id="campaign-overview-title">Campaign Overview</h2>
          </div>
        </div>
        <div className="report-metric-grid report-metric-grid-compact">
          <ReportMetric
            label="Analyzed snapshots"
            value={formatReportNumber(campaign.snapshotCount)}
          />
          <ReportMetric
            label="First snapshot"
            value={campaign.firstGameDate ?? "—"}
          />
          <ReportMetric
            label="Latest snapshot"
            value={campaign.latestGameDate ?? "—"}
          />
          <ReportMetric label="Scope" value={scopeName} />
        </div>
      </section>

      <section className="report-section" aria-labelledby="growth-summary-title">
        <div className="report-section-heading">
          <div>
            <span className="eyebrow">First and latest observations</span>
            <h2 id="growth-summary-title">Growth Summary</h2>
          </div>
        </div>
        <div className="report-table-wrap" role="region" tabIndex={0}>
          <table className="report-table report-change-table">
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col" className="num">First</th>
                <th scope="col" className="num">Latest</th>
                <th scope="col" className="num">Net change</th>
              </tr>
            </thead>
            <tbody>
              {GROWTH_METRICS.map(({ key, label, compact }) => {
                const firstValue = first
                  ? snapshotMetric(first, context, key)
                  : null;
                const latestValue = latest
                  ? snapshotMetric(latest, context, key)
                  : null;
                return (
                  <tr key={key}>
                    <th scope="row">{label}</th>
                    <td className="num">{formatReportNumber(firstValue, compact)}</td>
                    <td className="num">{formatReportNumber(latestValue, compact)}</td>
                    <td className="num">
                      {formatReportDelta(
                        firstValue !== null && latestValue !== null
                          ? latestValue - firstValue
                          : null,
                        compact,
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {snapshots.length > 1 && (
        <section className="report-section" aria-labelledby="campaign-chart-title">
          <div className="report-section-heading">
            <div>
              <span className="eyebrow">Raw industry values</span>
              <h2 id="campaign-chart-title">Campaign Chart</h2>
            </div>
          </div>
          <ReportIndustryChart snapshots={snapshots} context={context} />
        </section>
      )}

      <section className="report-section" aria-labelledby="milestones-title">
        <div className="report-section-heading">
          <div>
            <span className="eyebrow">Deterministic observations</span>
            <h2 id="milestones-title">Observed Milestones</h2>
          </div>
        </div>
        <div className="report-milestones">
          <article>
            <span>First snapshot</span>
            <strong>{first?.gameDate ?? "—"}</strong>
            <small>{first?.fileName ?? "Unavailable"}</small>
          </article>
          {milestones.map(({ label, result }) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{formatReportNumber(result?.value, true)}</strong>
              <small>
                {result
                  ? `${result.snapshot.gameDate} · ${formatReportNumber(result.value)}`
                  : "Unavailable"}
              </small>
            </article>
          ))}
          <article>
            <span>Latest snapshot</span>
            <strong>{latest?.gameDate ?? "—"}</strong>
            <small>{latest?.fileName ?? "Unavailable"}</small>
          </article>
        </div>
        <p className="report-note">
          Maxima are the highest values observed in analyzed snapshots. They do
          not imply historical events between saves.
        </p>
      </section>
    </ReportShell>
  );
}
