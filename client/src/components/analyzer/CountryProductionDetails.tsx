import { memo } from "react";
import type {
  CountryMilitaryProductionSummary,
  MilitaryProductionDefinitionSummary,
} from "@/types";
import {
  countryFullName,
  formatEquipmentDefinition,
  formatProductionRate,
} from "@/lib/utils";
import { ProductionLineTable } from "./ProductionLineTable";

interface Props {
  country: CountryMilitaryProductionSummary | null;
  selectedDefinition: MilitaryProductionDefinitionSummary | null;
  onSelectDefinition: (definition: string) => void;
}

function DefinitionRate({
  definition,
}: {
  definition: MilitaryProductionDefinitionSummary;
}) {
  if (definition.outputComplete) {
    return <>{formatProductionRate(definition.currentItemsPerDay)} / day</>;
  }

  const hasKnownRate = definition.lines.some(
    ({ currentItemsPerDay }) => currentItemsPerDay !== null,
  );
  return (
    <>
      {hasKnownRate
        ? `Known: ${formatProductionRate(definition.knownCurrentItemsPerDay)} / day`
        : "Unavailable"}
      <span className="production-cell-note">Some lines unavailable</span>
    </>
  );
}

export const CountryProductionDetails = memo(function CountryProductionDetails({
  country,
  selectedDefinition,
  onSelectDefinition,
}: Props) {
  if (!country) {
    return (
      <section className="panel production-details-panel production-empty">
        Select a country to inspect its current military production.
      </section>
    );
  }

  const summaryFields = [
    ["Production lines", country.lineCount],
    ["Definitions", country.definitionCount],
    ["Active factories", country.activeFactories],
    ["Requested", country.requestedFactories],
    ["Queued", country.queuedFactories],
    ["Damaged", country.damagedFactories],
    ["Resource shortages", country.resourceShortageLineCount],
  ] as const;

  return (
    <div className="production-details-column">
      <section className="panel production-details-panel">
        <div className="production-detail-head">
          <div>
            <h2>{countryFullName(country.countryTag)}</h2>
            <div className="micro-copy">
              Current land and air military production lines
            </div>
          </div>
        </div>

        <dl className="production-summary-grid">
          {summaryFields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value.toLocaleString()}</dd>
            </div>
          ))}
        </dl>

        {country.definitions.length === 0 ? (
          <div className="production-inner-empty">
            No resolved equipment definitions were found for this country.
          </div>
        ) : (
          <div className="table-wrap production-definition-wrap">
            <table className="recent-table production-definition-table">
              <thead>
                <tr>
                  <th>Equipment</th>
                  <th className="numeric-cell">Lines</th>
                  <th className="numeric-cell">Active / requested</th>
                  <th className="numeric-cell">Current rate</th>
                  <th className="numeric-cell">Shortage</th>
                </tr>
              </thead>
              <tbody>
                {country.definitions.map((definition) => {
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
                          <span className="production-resource-none">None</span>
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
