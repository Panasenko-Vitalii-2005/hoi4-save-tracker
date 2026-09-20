import { memo, useMemo } from "react";
import type {
  CountryMilitaryProductionSummary,
  MilitaryProductionDefinitionSummary,
} from "@/types";
import {
  formatEquipmentDefinition,
  formatProductionRate,
  formatProductionValue,
} from "@/lib/utils";
import { CountryDisplay } from "./CountryDisplay";
import { ProductionLineTable } from "./ProductionLineTable";
import { useAppTranslation } from "@/i18n";

interface Props {
  country: CountryMilitaryProductionSummary | null;
  selectedDefinition: MilitaryProductionDefinitionSummary | null;
  effectiveMilitaryFactories: number | null;
  onSelectDefinition: (definition: string) => void;
}

function DefinitionRate({
  definition,
}: {
  definition: MilitaryProductionDefinitionSummary;
}) {
  const { t } = useAppTranslation();
  if (definition.outputComplete) {
    return <>{t("production.perDay", { value: formatProductionRate(definition.currentItemsPerDay) })}</>;
  }

  const hasKnownRate = definition.lines.some(
    ({ currentItemsPerDay }) => currentItemsPerDay !== null,
  );
  return (
    <>
      {hasKnownRate
        ? t("production.perDay", { value: formatProductionRate(definition.knownCurrentItemsPerDay) })
        : t("common.unavailable")}
      <span className="production-cell-note">{t("production.someUnavailable")}</span>
    </>
  );
}

export const CountryProductionDetails = memo(function CountryProductionDetails({
  country,
  selectedDefinition,
  effectiveMilitaryFactories,
  onSelectDefinition,
}: Props) {
  const { t } = useAppTranslation();
  const sortedDefinitions = useMemo(
    () =>
      [...(country?.definitions ?? [])].sort(
        (left, right) =>
          right.activeFactories - left.activeFactories ||
          left.equipmentDefinition.localeCompare(right.equipmentDefinition),
      ),
    [country],
  );

  if (!country) {
    return (
      <section className="panel production-details-panel production-empty">
        {t("production.select")}
      </section>
    );
  }

  const summaryFields = [
    [t("production.currentLines"), country.lineCount],
    [t("stockpile.definitions"), country.definitionCount],
    [t("production.effectiveMil"), effectiveMilitaryFactories],
    [t("production.activeFactories"), country.activeFactories],
    [t("production.requested"), country.requestedFactories],
    [t("production.queued"), country.queuedFactories],
    [t("production.damaged"), country.damagedFactories],
    [t("production.shortageLines"), country.resourceShortageLineCount],
  ] as const;

  return (
    <div className="production-details-column">
      <section className="panel production-details-panel">
        <div className="production-detail-head">
          <div>
            <h2>
              <CountryDisplay tag={country.countryTag} />
            </h2>
            <div className="micro-copy">
              Current land and air military production lines
            </div>
          </div>
        </div>

        <dl className="production-summary-grid">
          {summaryFields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{formatProductionValue(value)}</dd>
            </div>
          ))}
        </dl>

        <p className="micro-copy">
          Effective military factories and production-line factory slots are
          separate save concepts and do not necessarily reconcile.
        </p>

        {country.definitions.length === 0 ? (
          <div className="production-inner-empty">
            No resolved equipment definitions were found for this country.
          </div>
        ) : (
          <div className="table-wrap production-definition-wrap">
            <table className="recent-table production-definition-table">
              <thead>
                <tr>
                  <th>{t("production.equipment")}</th>
                  <th className="numeric-cell">{t("production.lines")}</th>
                  <th className="numeric-cell">{t("production.activeRequested")}</th>
                  <th className="numeric-cell">{t("production.currentRate")}</th>
                  <th className="numeric-cell">{t("production.shortage")}</th>
                </tr>
              </thead>
              <tbody>
                {sortedDefinitions.map((definition) => {
                  const selected =
                    selectedDefinition?.equipmentDefinition ===
                    definition.equipmentDefinition;
                  return (
                    <tr
                      key={definition.equipmentDefinition}
                      className={selected ? "selected" : ""}
                      aria-selected={selected}
                      aria-label={`Inspect ${formatEquipmentDefinition(definition.equipmentDefinition)} production lines`}
                      onClick={() =>
                        onSelectDefinition(definition.equipmentDefinition)
                      }
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectDefinition(definition.equipmentDefinition);
                        }
                      }}
                    >
                      <td className="equipment-cell">
                        <strong>
                          {formatEquipmentDefinition(
                            definition.equipmentDefinition,
                          )}
                        </strong>
                        <span className="production-code">
                          {definition.equipmentDefinition}
                        </span>
                      </td>
                      <td className="numeric-cell">
                        {definition.lineCount.toLocaleString()}
                      </td>
                      <td className="numeric-cell">
                        {definition.activeFactories.toLocaleString()} /{" "}
                        {definition.requestedFactories.toLocaleString()}
                        {(definition.queuedFactories !== 0 ||
                          definition.damagedFactories !== 0) && (
                          <span className="production-cell-note">
                            {definition.queuedFactories !== 0 &&
                              `Queued: ${definition.queuedFactories.toLocaleString()}`}
                            {definition.queuedFactories !== 0 &&
                              definition.damagedFactories !== 0 &&
                              " · "}
                            {definition.damagedFactories !== 0 &&
                              `Damaged: ${definition.damagedFactories.toLocaleString()}`}
                          </span>
                        )}
                      </td>
                      <td className="numeric-cell">
                        <DefinitionRate definition={definition} />
                      </td>
                      <td className="numeric-cell">
                        {definition.resourceShortageLineCount > 0 ? (
                          <span className="production-shortage-badge">
                            {definition.resourceShortageLineCount.toLocaleString()}{" "}
                            {definition.resourceShortageLineCount === 1
                              ? "line"
                              : "lines"}
                          </span>
                        ) : (
                          <span className="production-resource-none">{t("common.none")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ProductionLineTable
        definition={selectedDefinition}
        unresolvedLines={country.unresolvedLines}
      />
    </div>
  );
});
