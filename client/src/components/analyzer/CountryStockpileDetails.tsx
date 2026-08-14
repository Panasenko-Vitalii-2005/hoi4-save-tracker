import { memo } from "react";
import type {
  CountryStockpileSummary,
  StockpileDefinitionSummary,
} from "@/types";
import {
  countryFullName,
  formatEquipmentDefinition,
  formatStockpileAmount,
} from "@/lib/utils";
import { StockpileVariantTable } from "./StockpileVariantTable";

interface Props {
  country: CountryStockpileSummary | null;
  selectedDefinition: StockpileDefinitionSummary | null;
  onSelectDefinition: (definition: string) => void;
}

export const CountryStockpileDetails = memo(function CountryStockpileDetails({
  country,
  selectedDefinition,
  onSelectDefinition,
}: Props) {
  if (!country) {
    return (
      <section className="panel stockpile-details-panel stockpile-empty">
        Select a country to inspect its national stockpile.
      </section>
    );
  }

  return (
    <div className="stockpile-details-column">
      <section className="panel stockpile-details-panel">
        <div className="stockpile-detail-head">
          <div>
            <h2>{countryFullName(country.countryTag)}</h2>
            <div className="micro-copy">
              National stockpile balances grouped by exact equipment definition
            </div>
          </div>
          <div className="stockpile-detail-count">
            <strong>{country.definitions.length.toLocaleString()}</strong>
            <span>definitions</span>
          </div>
        </div>

        {country.definitions.length === 0 ? (
          <div className="stockpile-inner-empty">
            No resolved equipment definitions were found for this country.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="recent-table stockpile-definition-table">
              <thead>
                <tr>
                  <th>Equipment</th>
                  <th className="numeric-cell">Amount</th>
                  <th className="numeric-cell">Designs</th>
                </tr>
              </thead>
              <tbody>
                {country.definitions.map((definition) => (
                  <tr
                    key={definition.definition}
                    className={
                      selectedDefinition?.definition === definition.definition
                        ? "selected"
                        : ""
                    }
                    aria-selected={
                      selectedDefinition?.definition === definition.definition
                    }
                    aria-label={`Inspect ${formatEquipmentDefinition(definition.definition)} designs`}
                    onClick={() => onSelectDefinition(definition.definition)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectDefinition(definition.definition);
                      }
                    }}
                  >
                    <td className="equipment-cell">
                      <strong>
                        {formatEquipmentDefinition(definition.definition)}
                      </strong>
                      <span className="stockpile-definition-code">
                        {definition.definition}
                      </span>
                    </td>
                    <td className="numeric-cell">
                      {formatStockpileAmount(definition.amount)}
                    </td>
                    <td className="numeric-cell">
                      {definition.variants.length.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <StockpileVariantTable
        definition={selectedDefinition}
        unresolvedVariants={country.unresolvedVariants}
      />
    </div>
  );
});
