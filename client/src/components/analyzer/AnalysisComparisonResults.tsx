import { useEffect, useMemo, useState } from "react";
import type {
  AnalysisComparisonDto,
  CountryComparison,
  NumericDiff,
} from "@/types/analysis-comparison";
import { countryFullName } from "@/lib/utils";
import { CountryDisplay } from "./CountryDisplay";

type CountryMetricKey = keyof Omit<
  CountryComparison,
  "tag" | "status" | "hasChanges"
>;
type SortKey = "largest" | "country" | CountryMetricKey;
type CountryScope = "changed" | "all";

interface CountryColumn {
  key: CountryMetricKey;
  label: string;
  shortLabel: string;
  compact?: boolean;
}

const COUNTRY_COLUMNS: readonly CountryColumn[] = [
  {
    key: "effectiveMilitaryFactories",
    label: "Military factories",
    shortLabel: "MIL",
  },
  {
    key: "effectiveCivilianFactories",
    label: "Civilian factories",
    shortLabel: "CIV",
  },
  {
    key: "effectiveDockyards",
    label: "Dockyards",
    shortLabel: "Docks",
  },
  { key: "divisions", label: "Divisions", shortLabel: "Divisions" },
  {
    key: "manpowerInField",
    label: "Manpower in field",
    shortLabel: "Manpower",
    compact: true,
  },
  { key: "ships", label: "Ships", shortLabel: "Ships" },
  {
    key: "calculatedWarCasualtiesTotal",
    label: "Calculated casualties",
    shortLabel: "Casualties",
    compact: true,
  },
];

const GLOBAL_COLUMNS: readonly {
  key: keyof AnalysisComparisonDto["summary"];
  label: string;
  compact?: boolean;
}[] = [
  { key: "activeCountries", label: "Active countries" },
  { key: "divisions", label: "Divisions" },
  { key: "manpowerInField", label: "Manpower in field", compact: true },
  { key: "aircraft", label: "Aircraft", compact: true },
  { key: "ships", label: "Ships" },
  { key: "navalLossCount", label: "Recorded naval losses" },
];

const exactNumber = (value: number | null) =>
  value === null
    ? "Unavailable"
    : value.toLocaleString(undefined, { maximumFractionDigits: 15 });

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
  return `${(absolute / divisor).toLocaleString("en-US", {
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
  if (diff.delta === null)
    return (
      <span className="comparison-delta-value unavailable" aria-label="Unavailable">
        N/A
      </span>
    );
  if (diff.delta === 0)
    return (
      <span className="comparison-delta-value no-change" aria-label="No change">
        {zero === "number" ? "0" : "—"}
      </span>
    );
  return (
    <span
      className={`comparison-delta-value ${
        diff.delta > 0 ? "increase" : "decrease"
      }`}
      aria-label={`${
        diff.delta > 0 ? "Target higher by" : "Target lower by"
      } ${Math.abs(diff.delta).toLocaleString()}`}
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
  return (
    <div className="comparison-metric-card">
      <span className="comparison-metric-label">{label}</span>
      <span className="comparison-metric-range">
        {exactNumber(diff.before)} <span aria-hidden="true">→</span>{" "}
        {exactNumber(diff.after)}
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
}: {
  data: AnalysisComparisonDto;
  baseName: string;
  targetName: string;
  showContext?: boolean;
}) {
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
      aria-label="Comparison results"
    >
      <div className="comparison-results-heading">
        <span className="eyebrow">Completed comparison</span>
        <div className="comparison-direction" aria-label="Comparison direction">
          <div>
            <span className="comparison-save-role">Base</span>
            <strong>{baseName}</strong>
            <span>{data.baseGameDate || "Unavailable"}</span>
          </div>
          <span className="comparison-direction-arrow" aria-hidden="true">
            →
          </span>
          <div>
            <span className="comparison-save-role">Target</span>
            <strong>{targetName}</strong>
            <span>{data.targetGameDate || "Unavailable"}</span>
          </div>
        </div>
      </div>
      {showContext && (
        <div className="comparison-context" aria-label="Comparison context">
          {data.context.sameAnalysis ? (
            <p className="comparison-context-note">
              Base and Target are the same saved analysis.
            </p>
          ) : data.context.chronology === "same_date" ? (
            <p className="comparison-context-note">
              Base and Target have the same game date.
            </p>
          ) : null}
          {data.context.chronology === "target_before_base" && (
            <p className="comparison-context-warning" role="status">
              Target save is earlier than Base save. Changes are still calculated
              as Target − Base.
            </p>
          )}
          {data.context.campaignCompatibility === "same" ? (
            <p className="comparison-context-note">Same campaign</p>
          ) : data.context.campaignCompatibility === "different" ? (
            <p className="comparison-context-warning" role="status">
              These saves appear to belong to different campaigns. The comparison
              is still a raw Target − Base snapshot difference.
            </p>
          ) : (
            <p className="comparison-context-note muted">
              Campaign relationship unknown
            </p>
          )}
          {data.context.gameVersionCompatibility === "different" && (
            <p className="comparison-context-warning" role="status">
              These saves use different game versions. Snapshot differences remain
              Target − Base.
            </p>
          )}
        </div>
      )}
      {!data.hasChanges && (
        <p className="comparison-no-differences" role="status">
          No differences in compared metrics.
        </p>
      )}
      <div className="comparison-summary" aria-label="Global change summary">
        {GLOBAL_COLUMNS.map(({ key, label, compact }) => (
          <SummaryCard
            key={key}
            label={label}
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
              aria-label="Country change filter"
            >
              {(["changed", "all"] as const).map((value) => (
                <button
                  key={value}
                  className={scope === value ? "active" : ""}
                  aria-pressed={scope === value}
                  onClick={() => setScope(value)}
                >
                  {value === "changed" ? "Changed only" : "All countries"}
                </button>
              ))}
            </div>
            <label className="comparison-search" htmlFor="comparison-country-search">
              <input
                id="comparison-country-search"
                type="search"
                aria-label="Search countries"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search countries..."
              />
            </label>
            <div
              className="comparison-sort-cluster"
              title="Metric sorts use the absolute size of each change."
            >
              <label className="comparison-sort" htmlFor="comparison-country-sort">
                <select
                  id="comparison-country-sort"
                  aria-label="Sort countries by"
                  value={sortKey}
                  onChange={(event) => changeSort(event.target.value as SortKey)}
                >
                  <option value="largest">Largest change</option>
                  <option value="country">Country name</option>
                  {COUNTRY_COLUMNS.map(({ key, label }) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="comparison-sort-direction"
                aria-label={
                  sortKey === "country"
                    ? descending
                      ? "Current order Z to A; sort country names A to Z"
                      : "Current order A to Z; sort country names Z to A"
                    : descending
                      ? "Current order largest first; sort smallest absolute changes first"
                      : "Current order smallest first; sort largest absolute changes first"
                }
                title={
                  sortKey === "country"
                    ? descending
                      ? "Z → A"
                      : "A → Z"
                    : descending
                      ? "Largest first"
                      : "Smallest first"
                }
                onClick={() => setDescending((value) => !value)}
              >
                <span aria-hidden="true">{descending ? "↓" : "↑"}</span>
              </button>
            </div>
          </div>

          {countries.length === 0 ? (
            <p className="comparison-empty micro-copy">
              No countries match these filters.
            </p>
          ) : (
            <div
              className="table-wrap comparison-table-scroll"
              role="region"
              aria-label="Country comparison table"
              tabIndex={0}
            >
              <table className="recent-table comparison-country-table">
                <thead>
                  <tr>
                    <th>Country</th>
                    <th>Tag</th>
                    {COUNTRY_COLUMNS.map(({ key, label, shortLabel }) => (
                      <th className="numeric-cell" key={key} title={label}>
                        <button
                          className="comparison-column-sort"
                          aria-label={`Sort by ${label}`}
                          onClick={() => changeSort(key)}
                        >
                          {shortLabel}
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
                              ? "Target only"
                              : "Base only"}
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
          <section className="comparison-detail" aria-label="Country detail">
            <span className="eyebrow">Country Detail</span>
            {selected ? (
              <>
                <h3>
                  <CountryDisplay tag={selected.tag} />
                </h3>
                {selected.status !== "unchanged" && (
                  <p className={`comparison-detail-status ${selected.status}`}>
                    {selected.status === "added"
                      ? "Present only in Target"
                      : "Present only in Base"}
                  </p>
                )}
                <div className="comparison-detail-summary">
                  {COUNTRY_COLUMNS.map(({ key, shortLabel, compact }) => (
                    <div key={key}>
                      <span>{shortLabel}</span>
                      <DeltaValue diff={selected[key]} compact={compact} />
                    </div>
                  ))}
                </div>
                <h4>Detailed breakdown</h4>
                <div className="table-wrap comparison-detail-scroll">
                  <table className="comparison-detail-table">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>Base</th>
                        <th>Target</th>
                        <th>Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {COUNTRY_COLUMNS.map(({ key, label }) => (
                        <tr key={key}>
                          <th scope="row">{label}</th>
                          <td>{exactNumber(selected[key].before)}</td>
                          <td>{exactNumber(selected[key].after)}</td>
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
              <p className="micro-copy">Select a country to inspect changes.</p>
            )}
          </section>

          <section className="comparison-about" aria-label="About changes">
            <h3>About changes</h3>
            <p>Values show Target − Base snapshot differences.</p>
            <dl>
              <div>
                <dt>Positive</dt>
                <dd>Target higher</dd>
              </div>
              <div>
                <dt>Negative</dt>
                <dd>Target lower</dd>
              </div>
              <div>
                <dt>—</dt>
                <dd>No change</dd>
              </div>
              <div>
                <dt>N/A</dt>
                <dd>Unavailable</dd>
              </div>
            </dl>
            <p className="micro-copy">
              Calculated casualty changes compare cumulative snapshot values; they
              do not prove casualties occurred during the selected interval.
              Recorded naval losses are event-count snapshot differences and do
              not prove those losses occurred strictly between the selected saves.
            </p>
          </section>
        </aside>
      </div>
    </section>
  );
}
