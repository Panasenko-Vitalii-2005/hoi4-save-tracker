import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  AnalysisComparisonDto,
  CountryComparison,
  NumericDiff,
} from "@/types/analysis-comparison";
import { countryFullName } from "@/lib/utils";
import { appLocale } from "@/i18n";
import { CountryDisplay } from "./CountryDisplay";
import { ExportControls } from "@/components/ui/ExportControls";
import {
  buildComparisonExport,
  comparisonCsv,
  comparisonExportFilename,
  prettyJson,
} from "@/lib/data-export";
import { EquipmentProductionComparisonPanel } from "./EquipmentProductionComparisonPanel";

type CountryMetricKey = keyof Omit<
  CountryComparison,
  "tag" | "status" | "hasChanges"
>;
type SortKey = "largest" | "country" | CountryMetricKey;
type CountryScope = "changed" | "all";

interface CountryColumn {
  key: CountryMetricKey;
  labelKey: string;
  shortLabelKey: string;
  compact?: boolean;
}

const COUNTRY_COLUMNS: readonly CountryColumn[] = [
  {
    key: "effectiveMilitaryFactories",
    labelKey: "compare.metrics.militaryFactories",
    shortLabelKey: "compare.metrics.militaryFactories",
  },
  {
    key: "effectiveCivilianFactories",
    labelKey: "compare.metrics.civilianFactories",
    shortLabelKey: "compare.metrics.civilianFactories",
  },
  {
    key: "effectiveDockyards",
    labelKey: "compare.metrics.dockyards",
    shortLabelKey: "compare.metrics.dockyards",
  },
  { key: "divisions", labelKey: "compare.metrics.divisions", shortLabelKey: "compare.metrics.divisions" },
  {
    key: "manpowerInField",
    labelKey: "compare.metrics.manpower",
    shortLabelKey: "compare.metrics.manpower",
    compact: true,
  },
  { key: "ships", labelKey: "compare.metrics.ships", shortLabelKey: "compare.metrics.ships" },
  {
    key: "calculatedWarCasualtiesTotal",
    labelKey: "compare.metrics.calculatedCasualties",
    shortLabelKey: "compare.metrics.calculatedCasualties",
    compact: true,
  },
];

const GLOBAL_COLUMNS: readonly {
  key: keyof AnalysisComparisonDto["summary"];
  labelKey: string;
  compact?: boolean;
}[] = [
  { key: "activeCountries", labelKey: "compare.metrics.activeCountries" },
  { key: "divisions", labelKey: "compare.metrics.divisions" },
  { key: "manpowerInField", labelKey: "compare.metrics.manpower", compact: true },
  { key: "aircraft", labelKey: "compare.metrics.aircraft", compact: true },
  { key: "ships", labelKey: "compare.metrics.ships" },
  { key: "navalLossCount", labelKey: "compare.metrics.navalLosses" },
];

const exactNumber = (value: number | null, unavailable: string) =>
  value === null
    ? unavailable
    : value.toLocaleString(appLocale(), { maximumFractionDigits: 15 });

function compactNumber(value: number): string {
  const absolute = Math.abs(value);
  const [divisor, suffix] =
    absolute >= 1_000_000_000
      ? [1_000_000_000, "B"]
      : absolute >= 1_000_000
        ? [1_000_000, "M"]
        : absolute >= 1_000
          ? [1_000, "k"]
          : [1, ""];
  return `${(absolute / divisor).toLocaleString(appLocale(), {
    maximumFractionDigits: divisor === 1 ? 15 : 2,
  })}${suffix}`;
}

function signedDelta(value: number, compact: boolean): string {
  const sign = value > 0 ? "+" : "-";
  const magnitude = compact
    ? compactNumber(value)
    : Math.abs(value).toLocaleString(undefined, {
        maximumFractionDigits: 15,
      });
  return `${sign}${magnitude}`;
}

function DeltaValue({
  diff,
  compact = false,
  zero = "dash",
}: {
  diff: NumericDiff;
  compact?: boolean;
  zero?: "dash" | "number";
}) {
  const { t } = useTranslation();
  if (diff.delta === null)
    return (
      <span className="comparison-delta-value unavailable" aria-label={t("compare.valueUnavailable")}>
        {t("compare.unavailableValue")}
      </span>
    );
  if (diff.delta === 0)
    return (
      <span className="comparison-delta-value no-change" aria-label={t("compare.noChange")}>
        {zero === "number" ? "0" : "—"}
      </span>
    );
  return (
    <span
      className={`comparison-delta-value ${
        diff.delta > 0 ? "increase" : "decrease"
      }`}
      aria-label={t(diff.delta > 0 ? "compare.targetHigherBy" : "compare.targetLowerBy", {
        value: Math.abs(diff.delta).toLocaleString(appLocale()),
      })}
    >
      {signedDelta(diff.delta, compact)}
    </span>
  );
}

function SummaryCard({
  label,
  diff,
  compact,
}: {
  label: string;
  diff: NumericDiff;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="comparison-metric-card">
      <span className="comparison-metric-label">{label}</span>
      <span className="comparison-metric-range">
        {exactNumber(diff.before, t("compare.valueUnavailable"))} <span aria-hidden="true">→</span>{" "}
        {exactNumber(diff.after, t("compare.valueUnavailable"))}
      </span>
      <DeltaValue diff={diff} compact={compact} zero="number" />
    </div>
  );
}

function magnitude(country: CountryComparison, key: SortKey): number | null {
  if (key === "country") return null;
  if (key === "largest") {
    const values = COUNTRY_COLUMNS.map(({ key: metric }) =>
      country[metric].delta === null ? null : Math.abs(country[metric].delta),
    ).filter((value): value is number => value !== null);
    return values.length ? Math.max(...values) : null;
  }
  const delta = country[key].delta;
  return delta === null ? null : Math.abs(delta);
}

export function AnalysisComparisonResults({
  data,
  baseName,
  targetName,
  showContext = true,
  onViewReport,
}: {
  data: AnalysisComparisonDto;
  baseName: string;
  targetName: string;
  showContext?: boolean;
  onViewReport: () => void;
}) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<CountryScope>("changed");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("largest");
  const [descending, setDescending] = useState(true);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const countries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = data.countries.filter(
      (country) =>
        (scope === "all" || country.hasChanges) &&
        (!query ||
          country.tag.toLocaleLowerCase().includes(query) ||
          countryFullName(country.tag).toLocaleLowerCase().includes(query)),
    );
    return [...filtered].sort((left, right) => {
      const byName =
        countryFullName(left.tag).localeCompare(countryFullName(right.tag)) ||
        left.tag.localeCompare(right.tag);
      if (sortKey === "country") return descending ? -byName : byName;
      const leftValue = magnitude(left, sortKey);
      const rightValue = magnitude(right, sortKey);
      if (leftValue === null && rightValue !== null) return 1;
      if (leftValue !== null && rightValue === null) return -1;
      if (leftValue !== null && rightValue !== null && leftValue !== rightValue)
        return descending ? rightValue - leftValue : leftValue - rightValue;
      return byName;
    });
  }, [data.countries, descending, scope, search, sortKey]);

  const selected = useMemo(
    () => data.countries.find((country) => country.tag === selectedTag) ?? null,
    [data.countries, selectedTag],
  );

  const selectedEquipmentProduction = useMemo(
    () =>
      data.equipmentProduction.find(
        (country) => country.countryTag === selectedTag,
      ) ?? null,
    [data.equipmentProduction, selectedTag],
  );

  useEffect(() => {
    const exists = data.countries.some(
      (country) => country.tag === selectedTag,
    );
    if (!exists) {
      setSelectedTag(countries[0]?.tag ?? null);
      return;
    }
    if (
      countries.length > 0 &&
      !countries.some((country) => country.tag === selectedTag)
    )
      setSelectedTag(countries[0].tag);
  }, [countries, data.countries, selectedTag]);

  const changeSort = (next: SortKey) => {
    if (next === sortKey) setDescending((value) => !value);
    else {
      setSortKey(next);
      setDescending(next !== "country");
    }
  };

  return (
    <section
      className="panel analysis-comparison-results"
      aria-label={t("compare.results")}
    >
      <div className="comparison-results-heading">
        <div className="comparison-results-title">
          <span className="eyebrow">{t("compare.completed")}</span>
          <button
            type="button"
            className="button button-primary"
            onClick={onViewReport}
          >
            {t("compare.viewReport")}
          </button>
          <ExportControls
            label={t("compare.exportCompleted")}
            createCsv={() => ({
              content: comparisonCsv(data, { baseName, targetName }),
              filename: comparisonExportFilename(
                data.baseGameDate,
                data.targetGameDate,
                "csv",
              ),
            })}
            createJson={() => ({
              content: prettyJson(
                buildComparisonExport(data, { baseName, targetName }),
              ),
              filename: comparisonExportFilename(
                data.baseGameDate,
                data.targetGameDate,
                "json",
              ),
            })}
          />
        </div>
        <div className="comparison-direction" aria-label={t("compare.direction")}>
          <div>
            <span className="comparison-save-role">{t("compare.base")}</span>
            <strong>{baseName}</strong>
            <span>{data.baseGameDate || t("compare.valueUnavailable")}</span>
          </div>
          <span className="comparison-direction-arrow" aria-hidden="true">
            →
          </span>
          <div>
            <span className="comparison-save-role">{t("compare.target")}</span>
            <strong>{targetName}</strong>
            <span>{data.targetGameDate || t("compare.valueUnavailable")}</span>
          </div>
        </div>
      </div>
      {showContext && (
        <div className="comparison-context" aria-label={t("compare.context")}>
          {data.context.sameAnalysis ? (
            <p className="comparison-context-note">
              {t("compare.sameAnalysis")}
            </p>
          ) : data.context.chronology === "same_date" ? (
            <p className="comparison-context-note">
              {t("compare.sameDate")}
            </p>
          ) : null}
          {data.context.chronology === "target_before_base" && (
            <p className="comparison-context-warning" role="status">
              {t("compare.targetEarlier")}
            </p>
          )}
          {data.context.campaignCompatibility === "same" ? (
            <p className="comparison-context-note">{t("compare.sameCampaign")}</p>
          ) : data.context.campaignCompatibility === "different" ? (
            <p className="comparison-context-warning" role="status">
              {t("compare.differentCampaign")}
            </p>
          ) : (
            <p className="comparison-context-note muted">
              {t("compare.campaignUnknown")}
            </p>
          )}
          {data.context.gameVersionCompatibility === "different" && (
            <p className="comparison-context-warning" role="status">
              {t("compare.differentVersion")}
            </p>
          )}
        </div>
      )}
      {!data.hasChanges && (
        <p className="comparison-no-differences" role="status">
          {t("compare.noDifferences")}
        </p>
      )}
      <div className="comparison-summary" aria-label={t("compare.globalSummary")}>
        {GLOBAL_COLUMNS.map(({ key, labelKey, compact }) => (
          <SummaryCard
            key={key}
            label={t(labelKey)}
            diff={data.summary[key]}
            compact={compact}
          />
        ))}
      </div>

      <div className="comparison-content-grid">
        <div className="comparison-country-panel">
          <div className="comparison-table-toolbar">
            <div
              className="comparison-scope-tabs"
              role="group"
              aria-label={t("compare.countryFilter")}
            >
              {(["changed", "all"] as const).map((value) => (
                <button
                  key={value}
                  className={scope === value ? "active" : ""}
                  aria-pressed={scope === value}
                  onClick={() => setScope(value)}
                >
                  {value === "changed" ? t("compare.changedOnly") : t("compare.allCountries")}
                </button>
              ))}
            </div>
            <label className="comparison-search" htmlFor="comparison-country-search">
              <input
                id="comparison-country-search"
                type="search"
                aria-label={t("compare.searchCountries")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("compare.searchPlaceholder")}
              />
            </label>
            <div
              className="comparison-sort-cluster"
              title={t("compare.sortHint")}
            >
              <label className="comparison-sort" htmlFor="comparison-country-sort">
                <select
                  id="comparison-country-sort"
                  aria-label={t("compare.sortBy")}
                  value={sortKey}
                  onChange={(event) => changeSort(event.target.value as SortKey)}
                >
                  <option value="largest">{t("compare.largestChange")}</option>
                  <option value="country">{t("compare.countryName")}</option>
                  {COUNTRY_COLUMNS.map(({ key, labelKey }) => (
                    <option key={key} value={key}>
                      {t(labelKey)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="comparison-sort-direction"
                aria-label={
                  sortKey === "country"
                    ? descending
                      ? t("compare.sortCountryAsc")
                      : t("compare.sortCountryDesc")
                    : descending
                      ? t("compare.sortSmallest")
                      : t("compare.sortLargest")
                }
                title={
                  sortKey === "country"
                    ? descending
                      ? "Z → A"
                      : "A → Z"
                    : descending
                      ? t("compare.largestFirst")
                      : t("compare.smallestFirst")
                }
                onClick={() => setDescending((value) => !value)}
              >
                <span aria-hidden="true">{descending ? "↓" : "↑"}</span>
              </button>
            </div>
          </div>

          {countries.length === 0 ? (
            <p className="comparison-empty micro-copy">
              {t("compare.noCountries")}
            </p>
          ) : (
            <div
              className="table-wrap comparison-table-scroll"
              role="region"
              aria-label={t("compare.countryTable")}
              tabIndex={0}
            >
              <table className="recent-table comparison-country-table">
                <thead>
                  <tr>
                    <th>{t("common.country")}</th>
                    <th>{t("compare.tag")}</th>
                    {COUNTRY_COLUMNS.map(({ key, labelKey, shortLabelKey }) => (
                      <th className="numeric-cell" key={key} title={t(labelKey)}>
                        <button
                          className="comparison-column-sort"
                          aria-label={t("compare.sortMetric", { metric: t(labelKey) })}
                          onClick={() => changeSort(key)}
                        >
                          {t(shortLabelKey)}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {countries.map((country) => (
                    <tr
                      key={country.tag}
                      className={selectedTag === country.tag ? "selected" : ""}
                      tabIndex={0}
                      aria-selected={selectedTag === country.tag}
                      onClick={() => setSelectedTag(country.tag)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedTag(country.tag);
                        }
                      }}
                    >
                      <td>
                        <span className="comparison-country-name">
                          {countryFullName(country.tag)}
                        </span>
                        {country.status !== "unchanged" && (
                          <span
                            className={`comparison-country-status ${country.status}`}
                          >
                            {country.status === "added"
                              ? t("compare.targetOnly")
                              : t("compare.baseOnly")}
                          </span>
                        )}
                      </td>
                      <td className="comparison-country-tag">{country.tag}</td>
                      {COUNTRY_COLUMNS.map(({ key, compact }) => (
                        <td className="numeric-cell" key={key}>
                          <DeltaValue diff={country[key]} compact={compact} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="comparison-sidebar">
          <section className="comparison-detail" aria-label={t("compare.countryDetail")}>
            <span className="eyebrow">{t("compare.countryDetail")}</span>
            {selected ? (
              <>
                <h3>
                  <CountryDisplay tag={selected.tag} />
                </h3>
                {selected.status !== "unchanged" && (
                  <p className={`comparison-detail-status ${selected.status}`}>
                    {selected.status === "added"
                      ? t("compare.presentTarget")
                      : t("compare.presentBase")}
                  </p>
                )}
                <div className="comparison-detail-summary">
                  {COUNTRY_COLUMNS.map(({ key, shortLabelKey, compact }) => (
                    <div key={key}>
                      <span>{t(shortLabelKey)}</span>
                      <DeltaValue diff={selected[key]} compact={compact} />
                    </div>
                  ))}
                </div>
                <h4>{t("compare.breakdown")}</h4>
                <div className="table-wrap comparison-detail-scroll">
                  <table className="comparison-detail-table">
                    <thead>
                      <tr>
                        <th>{t("compare.metric")}</th>
                        <th>{t("compare.base")}</th>
                        <th>{t("compare.target")}</th>
                        <th>{t("compare.change")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {COUNTRY_COLUMNS.map(({ key, labelKey }) => (
                        <tr key={key}>
                          <th scope="row">{t(labelKey)}</th>
                          <td>{exactNumber(selected[key].before, t("compare.valueUnavailable"))}</td>
                          <td>{exactNumber(selected[key].after, t("compare.valueUnavailable"))}</td>
                          <td>
                            <DeltaValue diff={selected[key]} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="micro-copy">{t("compare.selectCountryChanges")}</p>
            )}
          </section>

          <section className="comparison-about" aria-label={t("compare.about")}>
            <h3>{t("compare.about")}</h3>
            <p>{t("compare.valuesSemantics")}</p>
            <dl>
              <div>
                <dt>{t("compare.positive")}</dt>
                <dd>{t("compare.targetHigher")}</dd>
              </div>
              <div>
                <dt>{t("compare.negative")}</dt>
                <dd>{t("compare.targetLower")}</dd>
              </div>
              <div>
                <dt>—</dt>
                <dd>{t("compare.noChange")}</dd>
              </div>
              <div>
                <dt>{t("compare.unavailableValue")}</dt>
                <dd>{t("compare.valueUnavailable")}</dd>
              </div>
            </dl>
            <p className="micro-copy">
              {t("compare.casualtyCaveat")}
            </p>
          </section>
        </aside>
      </div>
      <EquipmentProductionComparisonPanel
        countryTag={selected?.tag ?? null}
        comparison={selectedEquipmentProduction}
      />
    </section>
  );
}
