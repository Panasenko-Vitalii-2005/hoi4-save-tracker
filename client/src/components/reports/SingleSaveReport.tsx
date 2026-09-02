import { useMemo } from "react";
import type { AnalyzeResult } from "@/types";
import {
  buildSingleSaveExport,
  prettyJson,
  singleSaveCsv,
  singleSaveExportFilename,
  type SingleSaveExportContext,
} from "@/lib/data-export";
import { countryFullName } from "@/lib/utils";
import { ReportMetric, ReportShell } from "./ReportShell";
import {
  formatReportDate,
  formatReportNumber,
} from "./report-utils";

export interface SingleSaveReportContext extends SingleSaveExportContext {
  playerCountryTag?: string | null;
}

export function SingleSaveReport({
  result,
  context,
  onBack,
}: {
  result: AnalyzeResult;
  context: SingleSaveReportContext;
  onBack: () => void;
}) {
  const playerCountry = useMemo(
    () =>
      context.playerCountryTag
        ? result.by_country.find(
            ({ tag }) => tag === context.playerCountryTag,
          ) ?? null
        : null,
    [context.playerCountryTag, result.by_country],
  );
  const majorCountries = useMemo(
    () =>
      [...result.by_country]
        .sort(
          (left, right) =>
            right.manpowerInField - left.manpowerInField ||
            countryFullName(left.tag).localeCompare(countryFullName(right.tag)),
        )
        .slice(0, 10),
    [result.by_country],
  );
  const reportName = playerCountry
    ? `${countryFullName(playerCountry.tag)} Save Report`
    : "Save Analysis Report";
  const countryLabel = playerCountry
    ? `${countryFullName(playerCountry.tag)} (${playerCountry.tag})`
    : null;

  return (
    <ReportShell
      eyebrow="Single save report"
      title={reportName}
      subtitle={formatReportDate(result.game_date)}
      metadata={
        <>
          {context.fileName && <span>{context.fileName}</span>}
          {countryLabel && <span>Player country: {countryLabel}</span>}
        </>
      }
      onBack={onBack}
      createCsv={() => ({
        content: singleSaveCsv(result, context),
        filename: singleSaveExportFilename(result.game_date, "csv"),
      })}
      createJson={() => ({
        content: prettyJson(buildSingleSaveExport(result, context)),
        filename: singleSaveExportFilename(result.game_date, "json"),
      })}
    >
      <section className="report-section report-introduction">
        <h2>Snapshot summary</h2>
        <p>
          This save records {formatReportNumber(result.active_countries)} active
          countries, {formatReportNumber(result.totals.divisions)} divisions and{" "}
          {formatReportNumber(result.totals.manpowerInField, true)} manpower in
          field on {result.game_date}.
        </p>
      </section>

      <section className="report-section" aria-labelledby="world-overview-title">
        <div className="report-section-heading">
          <div>
            <span className="eyebrow">Global snapshot</span>
            <h2 id="world-overview-title">World Overview</h2>
          </div>
        </div>
        <div className="report-metric-grid">
          <ReportMetric
            label="Active countries"
            value={formatReportNumber(result.active_countries)}
          />
          <ReportMetric
            label="Divisions"
            value={formatReportNumber(result.totals.divisions)}
          />
          <ReportMetric
            label="Manpower in field"
            value={formatReportNumber(result.totals.manpowerInField, true)}
            exact={formatReportNumber(result.totals.manpowerInField)}
          />
          <ReportMetric
            label="Aircraft"
            value={formatReportNumber(result.totals.aircraft, true)}
            exact={formatReportNumber(result.totals.aircraft)}
          />
          <ReportMetric
            label="Ships"
            value={formatReportNumber(result.totals.ships)}
          />
          <ReportMetric
            label="Recorded naval losses"
            value={formatReportNumber(result.navalLosses?.length ?? 0)}
          />
        </div>
      </section>

      <section className="report-section" aria-labelledby="industry-title">
        <div className="report-section-heading">
          <div>
            <span className="eyebrow">
              {playerCountry ? "Player country" : "Global totals"}
            </span>
            <h2 id="industry-title">Industry</h2>
          </div>
          <p>{countryLabel ?? "Player country unavailable"}</p>
        </div>
        <div className="report-metric-grid report-metric-grid-compact">
          <ReportMetric
            label="Military factories"
            value={formatReportNumber(
              playerCountry?.effectiveMilitaryFactories ??
                result.totals.effectiveMilitaryFactories,
            )}
          />
          <ReportMetric
            label="Civilian factories"
            value={formatReportNumber(
              playerCountry?.effectiveCivilianFactories ??
                result.totals.effectiveCivilianFactories,
            )}
          />
          <ReportMetric
            label="Dockyards"
            value={formatReportNumber(
              playerCountry?.effectiveDockyards ??
                result.totals.effectiveDockyards,
            )}
          />
        </div>
        {!playerCountry && (
          <p className="report-note">
            Player-country metadata is unavailable, so these values are world
            totals. No country has been inferred.
          </p>
        )}
      </section>

      {playerCountry && (
        <section
          className="report-section"
          aria-labelledby="player-military-title"
        >
          <div className="report-section-heading">
            <div>
              <span className="eyebrow">Current forces</span>
              <h2 id="player-military-title">{countryFullName(playerCountry.tag)}</h2>
            </div>
          </div>
          <div className="report-metric-grid">
            <ReportMetric
              label="Divisions"
              value={formatReportNumber(playerCountry.divisions)}
            />
            <ReportMetric
              label="Manpower in field"
              value={formatReportNumber(playerCountry.manpowerInField, true)}
              exact={formatReportNumber(playerCountry.manpowerInField)}
            />
            <ReportMetric
              label="Aircraft"
              value={formatReportNumber(playerCountry.aircraft)}
            />
            <ReportMetric
              label="Ships"
              value={formatReportNumber(playerCountry.ships)}
            />
            <ReportMetric
              label="Calculated war casualties"
              value={formatReportNumber(
                playerCountry.calculatedWarCasualtiesTotal,
                true,
              )}
              exact={formatReportNumber(
                playerCountry.calculatedWarCasualtiesTotal,
              )}
            />
          </div>
        </section>
      )}

      <section className="report-section" aria-labelledby="major-countries-title">
        <div className="report-section-heading">
          <div>
            <span className="eyebrow">Bounded ranking</span>
            <h2 id="major-countries-title">Major Countries</h2>
          </div>
          <p>Top {majorCountries.length} by manpower in field</p>
        </div>
        <div className="report-table-wrap" role="region" tabIndex={0}>
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col">Country</th>
                <th scope="col" className="num">Manpower</th>
                <th scope="col" className="num">Divisions</th>
                <th scope="col" className="num">Aircraft</th>
                <th scope="col" className="num">Ships</th>
                <th scope="col" className="num">MIL</th>
                <th scope="col" className="num">CIV</th>
                <th scope="col" className="num">Dockyards</th>
              </tr>
            </thead>
            <tbody>
              {majorCountries.map((country) => (
                <tr key={country.tag}>
                  <th scope="row">
                    {countryFullName(country.tag)} <small>{country.tag}</small>
                  </th>
                  <td className="num">
                    {formatReportNumber(country.manpowerInField)}
                  </td>
                  <td className="num">{formatReportNumber(country.divisions)}</td>
                  <td className="num">{formatReportNumber(country.aircraft)}</td>
                  <td className="num">{formatReportNumber(country.ships)}</td>
                  <td className="num">
                    {formatReportNumber(country.effectiveMilitaryFactories)}
                  </td>
                  <td className="num">
                    {formatReportNumber(country.effectiveCivilianFactories)}
                  </td>
                  <td className="num">
                    {formatReportNumber(country.effectiveDockyards)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </ReportShell>
  );
}
