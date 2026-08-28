import { useMemo, useState } from "react";
import type {
  AnalysisComparisonDto,
  CountryComparison,
  NumericDiff,
} from "@/types/analysis-comparison";
import { countryFullName } from "@/lib/utils";
import { CountryDisplay } from "./CountryDisplay";

const number = (value: number | null) =>
  value === null
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: 15 });

function DiffValue({ diff }: { diff: NumericDiff }) {
  return (
    <>
      <span>
        {number(diff.before)} → {number(diff.after)}
      </span>
      <span className="comparison-delta">
        {diff.delta !== null && diff.delta > 0 ? "+" : ""}
        {number(diff.delta)}
      </span>
    </>
  );
}

const COUNTRY_COLUMNS: [
  keyof Omit<CountryComparison, "tag" | "status" | "hasChanges">,
  string,
][] = [
  ["effectiveMilitaryFactories", "MIL"],
  ["effectiveCivilianFactories", "CIV"],
  ["effectiveDockyards", "Dockyards"],
  ["divisions", "Divisions"],
  ["manpowerInField", "Manpower in field"],
  ["ships", "Ships"],
  ["calculatedWarCasualtiesTotal", "Calculated casualties"],
];
const GLOBAL_COLUMNS: [keyof AnalysisComparisonDto["summary"], string][] = [
  ["activeCountries", "Active countries"],
  ["divisions", "Divisions"],
  ["manpowerInField", "Manpower in field"],
  ["aircraft", "Aircraft"],
  ["ships", "Ships"],
  ["navalLossCount", "Recorded naval losses"],
];

export function AnalysisComparisonResults({
  data,
  baseName,
  targetName,
}: {
  data: AnalysisComparisonDto;
  baseName: string;
  targetName: string;
}) {
  const [changedOnly, setChangedOnly] = useState(true);
  const [search, setSearch] = useState("");
  const countries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return data.countries.filter(
      (country) =>
        (!changedOnly || country.hasChanges) &&
        (!query ||
          country.tag.toLocaleLowerCase().includes(query) ||
          countryFullName(country.tag).toLocaleLowerCase().includes(query)),
    );
  }, [data, changedOnly, search]);

  return (
    <section
      className="panel analysis-comparison-results"
      aria-label="Comparison results"
    >
      <h2>Compare analyses</h2>
      <div className="comparison-direction">
        <div>
          <span className="micro-copy">Base</span>
          <strong>{baseName}</strong>
          <span>{data.baseGameDate || "—"}</span>
        </div>
        <span aria-hidden="true">→</span>
        <div>
          <span className="micro-copy">Target</span>
          <strong>{targetName}</strong>
          <span>{data.targetGameDate || "—"}</span>
        </div>
      </div>
      <p className="micro-copy">
        Every delta is Target − Base. Values are snapshot differences, not
        production or losses proven to have occurred between dates. Different
        campaigns can also be compared.
      </p>
      {!data.hasChanges && (
        <p role="status">No differences in compared metrics.</p>
      )}
      <dl className="comparison-summary">
        {GLOBAL_COLUMNS.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>
              <DiffValue diff={data.summary[key]} />
            </dd>
          </div>
        ))}
      </dl>
      <div className="analyzer-recent-controls">
        <label htmlFor="comparison-country-scope">
          Countries
          <select
            id="comparison-country-scope"
            value={changedOnly ? "changed" : "all"}
            onChange={(e) => setChangedOnly(e.target.value === "changed")}
          >
            <option value="changed">Changed only</option>
            <option value="all">All countries</option>
          </select>
        </label>
        <label htmlFor="comparison-country-search">
          Search countries
          <input
            id="comparison-country-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Country name or tag"
          />
        </label>
      </div>
      {countries.length === 0 ? (
        <p className="micro-copy">No countries match these filters.</p>
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
                {COUNTRY_COLUMNS.map(([key, label]) => (
                  <th className="numeric-cell" key={key}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {countries.map((country) => (
                <tr key={country.tag}>
                  <td>
                    <CountryDisplay tag={country.tag} />
                    {country.status !== "unchanged" && (
                      <div className="micro-copy">
                        {country.status === "added" ? "Added" : "Removed"}
                      </div>
                    )}
                  </td>
                  {COUNTRY_COLUMNS.map(([key]) => (
                    <td className="numeric-cell" key={key}>
                      <DiffValue diff={country[key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="micro-copy">
        Industry uses final effective factory totals. Calculated casualties sum
        bilateral war_relation records. Recorded naval losses count retained
        events, not complete lifetime losses. — means unavailable, including a
        country absent from one result; unavailable values are never treated as
        zero.
      </p>
    </section>
  );
}
