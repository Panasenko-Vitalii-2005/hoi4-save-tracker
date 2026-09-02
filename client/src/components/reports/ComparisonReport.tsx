import { useMemo } from "react";
import type {
  AnalysisComparisonDto,
  CountryComparison,
  NumericDiff,
} from "@/types/analysis-comparison";
import {
  buildComparisonExport,
  comparisonCsv,
  comparisonExportFilename,
  prettyJson,
} from "@/lib/data-export";
import { countryFullName } from "@/lib/utils";
import { ReportShell } from "./ReportShell";
import {
  diffStatus,
  formatReportDate,
  formatReportDelta,
  formatReportNumber,
} from "./report-utils";

const GLOBAL_METRICS: readonly {
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

const COUNTRY_METRICS: readonly {
  key: keyof Omit<CountryComparison, "tag" | "status" | "hasChanges">;
  label: string;
  short: string;
  compact?: boolean;
}[] = [
  { key: "effectiveMilitaryFactories", label: "Military factories", short: "MIL" },
  { key: "effectiveCivilianFactories", label: "Civilian factories", short: "CIV" },
  { key: "effectiveDockyards", label: "Dockyards", short: "Docks" },
  { key: "divisions", label: "Divisions", short: "Divisions" },
  { key: "manpowerInField", label: "Manpower in field", short: "Manpower", compact: true },
  { key: "ships", label: "Ships", short: "Ships" },
  {
    key: "calculatedWarCasualtiesTotal",
    label: "Calculated war casualties",
    short: "Casualties",
    compact: true,
  },
];

function ChangeCells({ diff, compact }: { diff: NumericDiff; compact?: boolean }) {
  return (
    <>
      <td className="num">{formatReportNumber(diff.before, compact)}</td>
      <td className="num">{formatReportNumber(diff.after, compact)}</td>
      <td className="num">
        <span className={diff.delta === null ? "unavailable" : ""}>
          {formatReportDelta(diff.delta, compact)}
        </span>
      </td>
    </>
  );
}
export function ComparisonReport({
  data,
  baseName,
  targetName,
  selectedCountryTag,
  onBack,
}: {
  data: AnalysisComparisonDto;
  baseName: string;
  targetName: string;
  selectedCountryTag: string | null;
  onBack: () => void;
}) {
  const selectedCountry = useMemo(
    () =>
      data.countries.find(({ tag }) => tag === selectedCountryTag) ?? null,
    [data.countries, selectedCountryTag],
  );
  const changedCountries = useMemo(
    () =>
      data.countries
        .filter(({ hasChanges, status }) => hasChanges || status !== "unchanged")
        .sort((left, right) =>
          countryFullName(left.tag).localeCompare(countryFullName(right.tag)),
        )
        .slice(0, 12),
    [data.countries],
  );
  const chronology =
    data.context.chronology === "target_after_base"
      ? "Target follows Base"
      : data.context.chronology === "target_before_base"
        ? "Target is earlier than Base"
        : data.context.chronology === "same_date"
          ? "Base and Target share a game date"
          : "Chronology unavailable";

  return (
    <ReportShell
      eyebrow="Save comparison report"
      title="Base and Target Comparison"
      subtitle={`${formatReportDate(data.baseGameDate)} → ${formatReportDate(data.targetGameDate)}`}
      metadata={
        <>
          <span>Base: {baseName}</span>
          <span>Target: {targetName}</span>
          <span>{chronology}</span>
        </>
      }
      onBack={onBack}
      createCsv={() => ({
        content: comparisonCsv(data, { baseName, targetName }),
        filename: comparisonExportFilename(
          data.baseGameDate,
          data.targetGameDate,
          "csv",
        ),
      })}
      createJson={() => ({
        content: prettyJson(buildComparisonExport(data, { baseName, targetName })),
        filename: comparisonExportFilename(
          data.baseGameDate,
          data.targetGameDate,
          "json",
        ),
      })}
    >
      <section className="report-section report-introduction">
        <h2>Comparison summary</h2>
        <p>
          Every change in this report is calculated as Target − Base. These are
          differences between two stored snapshots, not a reconstruction of all
          events during the interval.
        </p>
      </section>

      <section className="report-section" aria-labelledby="global-change-title">
        <div className="report-section-heading">
          <div>
            <span className="eyebrow">World snapshots</span>
            <h2 id="global-change-title">Global Change Summary</h2>
          </div>
        </div>
        <div className="report-table-wrap" role="region" tabIndex={0}>
          <table className="report-table report-change-table">
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col" className="num">Base</th>
                <th scope="col" className="num">Target</th>
                <th scope="col" className="num">Target − Base</th>
              </tr>
            </thead>
            <tbody>
              {GLOBAL_METRICS.map(({ key, label, compact }) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <ChangeCells diff={data.summary[key]} compact={compact} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedCountry && (
        <section className="report-section" aria-labelledby="selected-change-title">
          <div className="report-section-heading">
            <div>
              <span className="eyebrow">Selected country</span>
              <h2 id="selected-change-title">
                {countryFullName(selectedCountry.tag)} ({selectedCountry.tag})
              </h2>
            </div>
            <p>
              {selectedCountry.status === "added"
                ? "Present only in Target"
                : selectedCountry.status === "removed"
                  ? "Present only in Base"
                  : "Present in both snapshots"}
            </p>
          </div>
          <div className="report-table-wrap" role="region" tabIndex={0}>
            <table className="report-table report-change-table">
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col" className="num">Base</th>
                  <th scope="col" className="num">Target</th>
                  <th scope="col" className="num">Target − Base</th>
                </tr>
              </thead>
              <tbody>
                {COUNTRY_METRICS.map(({ key, label, compact }) => (
                  <tr key={key}>
                    <th scope="row">{label}</th>
                    <ChangeCells diff={selectedCountry[key]} compact={compact} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="report-section" aria-labelledby="country-changes-title">
        <div className="report-section-heading">
          <div>
            <span className="eyebrow">Concise country view</span>
            <h2 id="country-changes-title">Country Changes</h2>
          </div>
          <p>First {changedCountries.length} changed countries, alphabetical</p>
        </div>
        {changedCountries.length ? (
          <div className="report-table-wrap" role="region" tabIndex={0}>
            <table className="report-table report-country-change-table">
              <thead>
                <tr>
                  <th scope="col">Country</th>
                  <th scope="col">Snapshot presence</th>
                  {COUNTRY_METRICS.slice(0, 6).map(({ key, short }) => (
                    <th scope="col" className="num" key={key}>{short} Δ</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {changedCountries.map((country) => (
                  <tr key={country.tag}>
                    <th scope="row">
                      {countryFullName(country.tag)} <small>{country.tag}</small>
                    </th>
                    <td>{
                      country.status === "added"
                        ? "Target only"
                        : country.status === "removed"
                          ? "Base only"
                          : diffStatus(country.divisions)
                    }</td>
                    {COUNTRY_METRICS.slice(0, 6).map(({ key, compact }) => (
                      <td className="num" key={key}>
                        {formatReportDelta(country[key].delta, compact)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="report-note">No differences in compared metrics.</p>
        )}
      </section>

      <section className="report-section report-methodology" aria-labelledby="methodology-title">
        <div>
          <span className="eyebrow">Interpretation</span>
          <h2 id="methodology-title">Context and Methodology</h2>
        </div>
        <ul>
          <li>All deltas are Target − Base, even when Target is earlier.</li>
          <li>
            Campaign relationship: {data.context.campaignCompatibility}.
            {data.context.campaignCompatibility === "different" &&
              " Raw differences across campaigns should be interpreted cautiously."}
          </li>
          <li>
            Game-version relationship: {data.context.gameVersionCompatibility}.
          </li>
          <li>
            Calculated casualty differences compare cumulative snapshot values;
            they do not prove casualties occurred during this interval.
          </li>
          <li>
            Recorded naval-loss differences compare event counts in each
            snapshot; they are not an interval-loss ledger.
          </li>
        </ul>
      </section>
    </ReportShell>
  );
}
