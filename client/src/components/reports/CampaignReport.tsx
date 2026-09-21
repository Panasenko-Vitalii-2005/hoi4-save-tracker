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
import { useAppTranslation } from "@/i18n";
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
  compact?: boolean;
}[] = [
  { key: "divisions" },
  { key: "manpowerInField", compact: true },
  { key: "aircraft", compact: true },
  { key: "ships" },
  { key: "militaryFactories" },
  { key: "civilianFactories" },
  { key: "dockyards" },
];

const CHART_METRICS = [
  { key: "militaryFactories" as const, className: "mil" },
  { key: "civilianFactories" as const, className: "civ" },
  { key: "dockyards" as const, className: "dock" },
] as const;

const METRIC_KEYS = {
  divisions: "campaign.metrics.divisions",
  manpowerInField: "campaign.metrics.manpowerInField",
  aircraft: "campaign.metrics.aircraft",
  ships: "campaign.metrics.ships",
  activeCountries: "campaign.metrics.activeCountries",
  militaryFactories: "campaign.metrics.militaryFactories",
  civilianFactories: "campaign.metrics.civilianFactories",
  dockyards: "campaign.metrics.dockyards",
  calculatedCasualties: "campaign.metrics.calculatedCasualties",
} as const;

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
  const { t } = useAppTranslation();
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
        <strong>{t("report.campaign.observedIndustry")}</strong>
        <span>{t("report.campaign.chartCaption")}</span>
      </figcaption>
      <div className="report-chart-legend" aria-hidden="true">
        {CHART_METRICS.map((metric) => (
          <span key={metric.key} className={metric.className}>{t(METRIC_KEYS[metric.key])}</span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t("report.campaign.chartAria", { count: snapshots.length, maximum: formatReportNumber(maximum) })}
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
  const { t } = useAppTranslation();
  const snapshots = campaign.snapshots;
  const first = snapshots[0] ?? null;
  const latest = snapshots.at(-1) ?? null;
  const scopeName =
    context.scope === "country" && context.countryTag
      ? countryFullName(context.countryTag)
      : t("report.campaign.globalScope");
  const campaignName = campaign.playerCountryTag
    ? t("report.campaign.campaignSuffix", { country: countryFullName(campaign.playerCountryTag) })
    : campaign.campaignId
      ? t("report.campaign.known")
      : t("report.campaign.legacy");
  const milestones = useMemo(
    () => [
      {
        label: t("report.campaign.highestMilitary"),
        result: observedMaximum(snapshots, context, "militaryFactories"),
      },
      {
        label: t("report.campaign.highestManpower"),
        result: observedMaximum(snapshots, context, "manpowerInField"),
      },
      {
        label: t("report.campaign.highestDivisions"),
        result: observedMaximum(snapshots, context, "divisions"),
      },
    ],
    [context, snapshots, t],
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
      eyebrow={t("report.campaign.eyebrow")}
      title={campaignName}
      subtitle={`${formatReportDate(campaign.firstGameDate)} → ${formatReportDate(campaign.latestGameDate)}`}
      metadata={
        <>
          <span>{t("report.campaign.analyzedSaves", { count: formatReportNumber(campaign.snapshotCount) })}</span>
          <span>{t("report.campaign.scope", { scope: scopeName })}</span>
          {campaign.campaignId && (
            <span title={campaign.campaignId}>
              {t("report.campaign.campaignId", { id: `${campaign.campaignId.slice(0, 8)}…${campaign.campaignId.slice(-4)}` })}
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
        <h2>{t("report.campaign.summary")}</h2>
        <p>{t("report.campaign.summaryText", { count: formatReportNumber(campaign.snapshotCount), first: formatReportNumber(firstMil), latest: formatReportNumber(latestMil), change: formatReportDelta(milChange) })}</p>
      </section>

      <section className="report-section" aria-labelledby="campaign-overview-title">
        <div className="report-section-heading">
          <div>
            <span className="eyebrow">{t("report.campaign.storedHistory")}</span>
            <h2 id="campaign-overview-title">{t("report.campaign.overview")}</h2>
          </div>
        </div>
        <div className="report-metric-grid report-metric-grid-compact">
          <ReportMetric
            label={t("report.campaign.snapshots")}
            value={formatReportNumber(campaign.snapshotCount)}
          />
          <ReportMetric
            label={t("report.campaign.firstSnapshot")}
            value={campaign.firstGameDate ?? "—"}
          />
          <ReportMetric
            label={t("report.campaign.latestSnapshot")}
            value={campaign.latestGameDate ?? "—"}
          />
          <ReportMetric label={t("report.campaign.scopeLabel")} value={scopeName} />
        </div>
      </section>

      <section className="report-section" aria-labelledby="growth-summary-title">
        <div className="report-section-heading">
          <div>
            <span className="eyebrow">{t("report.campaign.firstLatest")}</span>
            <h2 id="growth-summary-title">{t("report.campaign.growth")}</h2>
          </div>
        </div>
        <div className="report-table-wrap" role="region" tabIndex={0}>
          <table className="report-table report-change-table">
            <thead>
              <tr>
                <th scope="col">{t("report.campaign.metric")}</th>
                <th scope="col" className="num">{t("report.campaign.first")}</th>
                <th scope="col" className="num">{t("report.campaign.latest")}</th>
                <th scope="col" className="num">{t("report.campaign.netChange")}</th>
              </tr>
            </thead>
            <tbody>
              {GROWTH_METRICS.map(({ key, compact }) => {
                const firstValue = first
                  ? snapshotMetric(first, context, key)
                  : null;
                const latestValue = latest
                  ? snapshotMetric(latest, context, key)
                  : null;
                return (
                  <tr key={key}>
                    <th scope="row">{t(METRIC_KEYS[key])}</th>
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
              <span className="eyebrow">{t("report.campaign.rawIndustry")}</span>
              <h2 id="campaign-chart-title">{t("report.campaign.chart")}</h2>
            </div>
          </div>
          <ReportIndustryChart snapshots={snapshots} context={context} />
        </section>
      )}

      <section className="report-section" aria-labelledby="milestones-title">
        <div className="report-section-heading">
          <div>
            <span className="eyebrow">{t("report.campaign.observations")}</span>
            <h2 id="milestones-title">{t("report.campaign.milestones")}</h2>
          </div>
        </div>
        <div className="report-milestones">
          <article>
            <span>{t("report.campaign.firstSnapshot")}</span>
            <strong>{first?.gameDate ?? "—"}</strong>
            <small>{first?.fileName ?? t("report.campaign.unavailable")}</small>
          </article>
          {milestones.map(({ label, result }) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{formatReportNumber(result?.value, true)}</strong>
              <small>
                {result
                  ? t("report.campaign.milestoneValue", { date: result.snapshot.gameDate, value: formatReportNumber(result.value) })
                  : t("report.campaign.unavailable")}
              </small>
            </article>
          ))}
          <article>
            <span>{t("report.campaign.latestSnapshot")}</span>
            <strong>{latest?.gameDate ?? "—"}</strong>
            <small>{latest?.fileName ?? t("report.campaign.unavailable")}</small>
          </article>
        </div>
        <p className="report-note">
          {t("report.campaign.note")}
        </p>
      </section>
    </ReportShell>
  );
}
