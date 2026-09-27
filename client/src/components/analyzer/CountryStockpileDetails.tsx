import { Fragment, memo, useMemo, useState } from "react";
import type {
  CountryStockpileSummary,
  StockpileDefinitionSummary,
} from "@/types";
import { formatEquipmentDefinition } from "@/lib/utils";
import { CountryDisplay } from "./CountryDisplay";
import { StockpileBalance } from "./StockpileBalance";
import { StockpileVariantTable, UnresolvedStockpileTable } from "./StockpileVariantTable";
import { useAppTranslation } from "@/i18n";

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
  const { t } = useAppTranslation();
  const [search, setSearch] = useState("");
  const definitions = country?.definitions;
  const filteredDefinitions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return definitions ?? [];
    return (definitions ?? []).filter((definition) =>
      `${formatEquipmentDefinition(definition.definition)} ${definition.definition}`
        .toLowerCase()
        .includes(query),
    );
  }, [definitions, search]);

  if (!country) {
    return (
      <section className="panel stockpile-details-panel stockpile-empty">
        {t("stockpile.select")}
      </section>
    );
  }

  const variantCount = country.definitions.reduce(
    (total, definition) => total + definition.variants.length,
    0,
  );

  return (
    <div className="stockpile-details-column">
      <section className="panel stockpile-details-panel">
        <div className="stockpile-detail-head">
          <div>
            <h2><CountryDisplay tag={country.countryTag} /></h2>
            <div className="micro-copy">{t("stockpile.detailDescription")}</div>
          </div>
          <div className="stockpile-detail-count">
            <strong>{t("stockpile.definitionCount", { count: country.definitions.length })}</strong>
            <span>{t("stockpile.variantCount", { count: variantCount })}</span>
          </div>
        </div>

        {country.definitions.length === 0 ? (
          <div className="stockpile-inner-empty">{t("stockpile.noDefinitions")}</div>
        ) : (
          <>
            <label className="stockpile-search">
              <span>{t("stockpile.search")}</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("stockpile.searchPlaceholder")}
              />
            </label>
            {filteredDefinitions.length === 0 ? (
              <div className="stockpile-inner-empty">{t("stockpile.searchEmpty")}</div>
            ) : (
              <div className="table-wrap stockpile-definition-wrap">
                <table className="recent-table stockpile-definition-table">
                  <thead>
                    <tr>
                      <th>{t("stockpile.equipment")}</th>
                      <th className="numeric-cell">{t("stockpile.amount")}</th>
                      <th className="numeric-cell">{t("stockpile.designs")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDefinitions.map((definition) => {
                      const name = formatEquipmentDefinition(definition.definition);
                      const expanded = selectedDefinition?.definition === definition.definition;
                      return (
                        <Fragment key={definition.definition}>
                          <tr
                            className={expanded ? "selected" : ""}
                            onClick={() => onSelectDefinition(definition.definition)}
                          >
                            <td className="equipment-cell">
                              <button
                                type="button"
                                className="stockpile-expand-button"
                                aria-expanded={expanded}
                                aria-label={t(expanded ? "stockpile.hideVariants" : "stockpile.inspectVariants", { name })}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onSelectDefinition(definition.definition);
                                }}
                              >
                                <span className="stockpile-chevron" aria-hidden="true">▸</span>
                                <span>
                                  <strong>{name}</strong>
                                  <span className="stockpile-definition-code">{definition.definition}</span>
                                </span>
                              </button>
                            </td>
                            <td className="numeric-cell">
                              <StockpileBalance amount={definition.amount} />
                            </td>
                            <td className="numeric-cell">
                              {definition.variants.length.toLocaleString()}
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="stockpile-variant-expansion">
                              <td colSpan={3}>
                                <div className="stockpile-variant-scroll">
                                  <StockpileVariantTable definition={definition} />
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
      <UnresolvedStockpileTable variants={country.unresolvedVariants} />
    </div>
  );
});
