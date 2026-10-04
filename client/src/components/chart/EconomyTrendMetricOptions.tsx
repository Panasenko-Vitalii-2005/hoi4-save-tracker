import { useTranslation } from "react-i18next";
import { ECONOMY_RESOURCES } from "@/types/economy";
import type { TrendMetric } from "@/types/campaign-trends";
import { ECONOMY_TREND_METRICS } from "@/lib/economy-metrics";
import "./EconomyTrendControls.css";

export function EconomyTrendMetricOptions({
  metrics,
  label,
  onChange,
}: {
  metrics: TrendMetric[];
  label: (metric: TrendMetric) => string;
  onChange: (metrics: TrendMetric[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="campaign-economy-metrics">
      <strong>{t("economy.title")}</strong>
      {ECONOMY_RESOURCES.map((resource) => (
        <details key={resource}>
          <summary>{t(`economy.resources.${resource}`)}</summary>
          {ECONOMY_TREND_METRICS.filter(
            (metric) => metric.resource === resource,
          ).map((metric) => (
            <label key={metric.key}>
              <input
                type="checkbox"
                checked={metrics.includes(metric.key)}
                onChange={(event) => {
                  const selected = event.target.checked
                    ? [...metrics, metric.key]
                    : metrics.filter((key) => key !== metric.key);
                  if (selected.length) onChange(selected);
                }}
              />
              <span>{label(metric.key)}</span>
            </label>
          ))}
        </details>
      ))}
    </div>
  );
}
