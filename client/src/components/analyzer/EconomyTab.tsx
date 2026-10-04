import { Fragment, useState } from "react";
import { appLocale, useAppTranslation } from "@/i18n";
import { getCountryDisplayName } from "@/lib/countryNames";
import { resolvePreferredCountryTag } from "@/lib/utils";
import {
  formatEconomyEfficiency,
  formatEconomyNumber,
  rawEconomyValue,
} from "@/lib/economy-display";
import {
  ECONOMY_RESOURCES,
  type EconomyAnalysis,
  type EconomyResource,
  type EconomyResourceSummary,
} from "@/types/economy";
import { CountryDisplay } from "./CountryDisplay";
import "./EconomyTab.css";

function EconomyValue({
  value,
  exact = false,
  percent = false,
}: {
  value: number | null | undefined;
  exact?: boolean;
  percent?: boolean;
}) {
  const { t, i18n } = useAppTranslation();
  const raw = rawEconomyValue(value);
  return (
    <span
      title={value == null ? undefined : t("economy.rawValue", { value: raw })}
    >
      {exact
        ? raw
        : percent
          ? formatEconomyEfficiency(value, appLocale(i18n.language))
          : formatEconomyNumber(value, appLocale(i18n.language))}
    </span>
  );
}

function ResourceDetail({
  economy,
  countryTag,
  resource,
  summary,
}: {
  economy: EconomyAnalysis;
  countryTag: string;
  resource: EconomyResource;
  summary: EconomyResourceSummary | undefined;
}) {
  const { t } = useAppTranslation();
  const trades = economy.commercialTrades.filter(
    (trade) =>
      trade.resource === resource &&
      (trade.importerTag === countryTag || trade.exporterTag === countryTag),
  );
  const rights = economy.resourceRightsOrigins.filter(
    (origin) =>
      (origin.beneficiaryTag === countryTag ||
        origin.giverTag === countryTag) &&
      (origin.resources[resource] != null ||
        origin.givenResourceRights.some(
          (right) => right.resource === resource,
        )),
  );
  const ledgerValues = [
    ["extracted", summary?.extracted],
    ["imported", summary?.imported],
    ["exported", summary?.exportAllocation],
    ["projects", summary?.projectDemand],
    ["production", summary?.productionDemand.total],
    ["balance", summary?.serializedBalance],
  ] as const;
  const additionalValues = [
    ["baseExport", summary?.baseExport],
    ["savedExported", summary?.savedExported],
    ["beforeDemand", summary?.serializedAvailableBeforeDemand],
    ["transfer", summary?.transferOverlordSubject],
    ["ledgerProjects", summary?.serializedProjectDemand],
    ["ledgerProduction", summary?.serializedProductionDemand],
    ["militaryDemand", summary?.productionDemand.military],
    ["navalDemand", summary?.productionDemand.naval],
    ["refitDemand", summary?.productionDemand.refit],
    ["energyDemand", summary?.productionDemand.energy],
  ] as const;
  const routeName = (type: "land" | "sea" | null | undefined) =>
    t(`economy.routes.${type ?? "unknown"}`);
  return (
    <div className="economy-resource-detail" id={`economy-detail-${resource}`}>
      <section aria-label={t("economy.ledger")}>
        <h3>{t("economy.ledger")}</h3>
        <p className="micro-copy">{t("economy.exactHint")}</p>
        <dl className="economy-facts">
          {ledgerValues.map(([key, value]) => (
            <div key={key}>
              <dt>{t(`economy.${key}`)}</dt>
              <dd>
                <EconomyValue value={value} exact />
              </dd>
            </div>
          ))}
        </dl>
        <details className="economy-additional">
          <summary>{t("economy.accountingDetails")}</summary>
          <dl className="economy-facts">
            {additionalValues.map(([key, value]) => (
              <div key={key}>
                <dt>{t(`economy.${key}`)}</dt>
                <dd>
                  <EconomyValue value={value} exact />
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </section>
      <section
        aria-label={t("economy.commercialTrades")}
        className="economy-trades"
      >
        <h3>{t("economy.commercialTrades")}</h3>
        <p className="micro-copy">{t("economy.tradeCaveat")}</p>
        {trades.length === 0 ? (
          <p className="micro-copy">{t("economy.noTrades")}</p>
        ) : (
          <div className="table-wrap">
            <table
              className="recent-table economy-trade-table"
              aria-label={t("economy.commercialTrades")}
            >
              <thead>
                <tr>
                  {[
                    "partner",
                    "direction",
                    "delivered",
                    "civ",
                    "route",
                    "efficiency",
                    "convoys",
                  ].map((key) => (
                    <th key={key} scope="col">
                      {t(`economy.${key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.map((trade, index) => {
                  const incoming = trade.importerTag === countryTag;
                  return (
                    <tr
                      key={`${trade.exporterTag}:${trade.relationRef?.type}:${trade.relationRef?.id}:${index}`}
                    >
                      <td>
                        <CountryDisplay
                          tag={incoming ? trade.exporterTag : trade.importerTag}
                          unknownLabel={t("common.unknown")}
                        />
                      </td>
                      <td>
                        {t(
                          incoming
                            ? "economy.importDirection"
                            : "economy.exportDirection",
                        )}
                      </td>
                      <td className="numeric-cell">
                        <EconomyValue value={trade.deliveredRaw} exact />
                      </td>
                      <td className="numeric-cell">
                        <EconomyValue value={trade.requiredCic} /> /{" "}
                        <EconomyValue value={trade.lendedCic} />
                      </td>
                      <td>{routeName(trade.route?.routeType)}</td>
                      <td className="numeric-cell">
                        <EconomyValue value={trade.efficiency} percent />
                        <span className="economy-cell-note">
                          {t("economy.convoyEfficiency")}:{" "}
                          <EconomyValue
                            value={trade.efficiencyDueToLostConvoys}
                            percent
                          />
                        </span>
                      </td>
                      <td className="numeric-cell">
                        {trade.convoySubscriber ? (
                          <>
                            <EconomyValue
                              value={trade.convoySubscriber.convoys}
                            />{" "}
                            /{" "}
                            <EconomyValue
                              value={trade.convoySubscriber.total}
                            />
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {trades.some((trade) => trade.warnings.length) && (
          <p className="micro-copy">{t("economy.partial")}</p>
        )}
      </section>
      <section
        aria-label={t("economy.resourceRights")}
        className="economy-rights"
      >
        <h3>{t("economy.resourceRights")}</h3>
        <p className="micro-copy">{t("economy.rightsCaveat")}</p>
        {rights.length === 0 ? (
          <p className="micro-copy">{t("economy.noRights")}</p>
        ) : (
          <div className="table-wrap">
            <table
              className="recent-table economy-rights-table"
              aria-label={t("economy.resourceRights")}
            >
              <thead>
                <tr>
                  {[
                    "giver",
                    "beneficiary",
                    "state",
                    "rightsQuantity",
                    "route",
                    "efficiency",
                  ].map((key) => (
                    <th key={key} scope="col">
                      {t(`economy.${key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rights.map((origin, index) => (
                  <tr
                    key={`${origin.originRef?.type}:${origin.originRef?.id}:${index}`}
                  >
                    <td>
                      <CountryDisplay
                        tag={origin.giverTag}
                        unknownLabel={t("common.unknown")}
                      />
                    </td>
                    <td>
                      <CountryDisplay tag={origin.beneficiaryTag} />
                    </td>
                    <td>
                      {origin.stateId == null
                        ? "—"
                        : t("economy.stateId", { id: origin.stateId })}
                    </td>
                    <td className="numeric-cell">
                      <EconomyValue value={origin.resources[resource]} exact />
                    </td>
                    <td>{routeName(origin.route?.routeType)}</td>
                    <td className="numeric-cell">
                      <EconomyValue value={origin.efficiency} percent />
                      <span className="economy-cell-note">
                        {t("economy.convoyEfficiency")}:{" "}
                        <EconomyValue
                          value={origin.efficiencyDueToLostConvoys}
                          percent
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rights.some((origin) => origin.warnings.length) && (
          <p className="micro-copy">{t("economy.partial")}</p>
        )}
      </section>
    </div>
  );
}

export function EconomyTab({
  economy,
  preferredCountryTag,
  selectedTag,
  onSelectedTagChange,
}: {
  economy?: EconomyAnalysis;
  preferredCountryTag?: string | null;
  selectedTag: string | null;
  onSelectedTagChange: (tag: string | null) => void;
}) {
  const { t } = useAppTranslation();
  const [expandedResource, setExpandedResource] =
    useState<EconomyResource | null>(null);
  if (!economy)
    return (
      <section className="panel economy-empty" role="status">
        <h2>{t("economy.unavailable")}</h2>
        <p className="micro-copy">{t("economy.legacy")}</p>
      </section>
    );
  if (economy.countrySummaries.length === 0)
    return (
      <section className="panel economy-empty" role="status">
        {t("economy.empty")}
      </section>
    );
  const tags = economy.countrySummaries.map((country) => country.countryTag);
  const countryTag = tags.includes(selectedTag ?? "")
    ? selectedTag!
    : resolvePreferredCountryTag(tags, preferredCountryTag)!;
  const country = economy.countrySummaries.find(
    (entry) => entry.countryTag === countryTag,
  )!;
  return (
    <section className="panel economy-panel">
      <div className="panel-head economy-head">
        <h2>
          <CountryDisplay tag={countryTag} />
        </h2>
        <label className="compact-field">
          {t("common.country")}
          <select
            value={countryTag}
            onChange={(event) => {
              onSelectedTagChange(event.target.value);
              setExpandedResource(null);
            }}
          >
            {economy.countrySummaries.map((entry) => (
              <option key={entry.countryTag} value={entry.countryTag}>
                {getCountryDisplayName(entry.countryTag)} · {entry.countryTag}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="micro-copy economy-note">{t("economy.serializedNote")}</p>
      {country.warnings.length > 0 && (
        <p className="micro-copy">{t("economy.partial")}</p>
      )}
      <div className="table-wrap economy-table-scroll">
        <table
          className="recent-table economy-resource-table"
          aria-label={t("economy.resourceTable")}
        >
          <thead>
            <tr>
              {[
                "resource",
                "extracted",
                "imported",
                "exported",
                "projects",
                "production",
                "balance",
              ].map((key) => (
                <th key={key} scope="col">
                  {t(`economy.${key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ECONOMY_RESOURCES.map((resource) => {
              const summary = country.resources.find(
                (entry) => entry.resource === resource,
              );
              const expanded = expandedResource === resource;
              const values = [
                summary?.extracted,
                summary?.imported,
                summary?.exportAllocation,
                summary?.projectDemand,
                summary?.productionDemand.total,
                summary?.serializedBalance,
              ];
              return (
                <Fragment key={resource}>
                  <tr
                    className={expanded ? "selected" : ""}
                    data-resource={resource}
                  >
                    <th scope="row">
                      <button
                        type="button"
                        className="economy-expand-button"
                        aria-expanded={expanded}
                        aria-controls={`economy-detail-${resource}`}
                        onClick={() =>
                          setExpandedResource(expanded ? null : resource)
                        }
                      >
                        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
                        {t(`economy.resources.${resource}`)}
                      </button>
                    </th>
                    {values.map((value, index) => (
                      <td
                        key={index}
                        className={`numeric-cell${index === 5 && value != null && value < 0 ? " economy-negative" : ""}`}
                      >
                        <EconomyValue value={value} />
                      </td>
                    ))}
                  </tr>
                  {expanded && (
                    <tr className="economy-expansion">
                      <td colSpan={7}>
                        <ResourceDetail
                          economy={economy}
                          countryTag={countryTag}
                          resource={resource}
                          summary={summary}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="micro-copy economy-note">{t("economy.inspectHint")}</p>
    </section>
  );
}
