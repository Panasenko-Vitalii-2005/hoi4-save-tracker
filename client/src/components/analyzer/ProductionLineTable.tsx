import { memo } from "react";
import type {
  MilitaryProductionDefinitionSummary,
  MilitaryProductionLineSummary,
  ProductionResourceShortage,
} from "@/types";
import {
  formatCountryDisplayName,
  formatEquipmentDefinition,
  formatProductionProgress,
  formatProductionRate,
  formatProductionValue,
} from "@/lib/utils";
import { useAppTranslation } from "@/i18n";

function lineKey(line: MilitaryProductionLineSummary, index: number): string {
  const lineReference = line.lineRef
    ? `${line.lineRef.type}:${line.lineRef.id}`
    : "unknown-line";
  const equipmentReference = line.equipmentRef
    ? `${line.equipmentRef.type}:${line.equipmentRef.id}`
    : "unknown-equipment";
  return `${lineReference}-${equipmentReference}-${index}`;
}

function shortageLabel(shortage: ProductionResourceShortage): string {
  return shortage.resource
    ? formatEquipmentDefinition(shortage.resource)
    : "Unknown resource";
}

function DesignCell({
  line,
  unresolved,
  index,
}: {
  line: MilitaryProductionLineSummary;
  unresolved: boolean;
  index: number;
}) {
  const { t } = useAppTranslation();
  return (
    <td className="design-cell">
      <strong>
        {unresolved
          ? `Unresolved production line ${index + 1}`
          : line.variantName?.trim() || t("production.unnamedDesign")}
      </strong>
      {line.obsolete && <span className="production-obsolete">{t("common.obsolete")}</span>}
      {!line.complete && (
        <span className="production-partial">{t("production.partialData")}</span>
      )}
      {!unresolved && (
        <span className="production-line-meta">
          {line.version !== null && `Version ${line.version}`}
          {line.version !== null && line.creatorTag && " · "}
          {line.creatorTag &&
            `Creator: ${formatCountryDisplayName(line.creatorTag)}`}
          {(line.version !== null || line.creatorTag) &&
            line.originTag &&
            " · "}
          {line.originTag &&
            `Origin: ${formatCountryDisplayName(line.originTag)}`}
        </span>
      )}
    </td>
  );
}

function FactoriesCell({ line }: { line: MilitaryProductionLineSummary }) {
  return (
    <td className="numeric-cell production-factories-cell">
      <strong>
        {formatProductionValue(line.activeFactories)} /{" "}
        {formatProductionValue(line.requestedFactories)}
      </strong>
      {(line.queuedFactories !== null && line.queuedFactories !== 0) ||
      (line.damagedFactories !== null && line.damagedFactories !== 0) ? (
        <span className="production-cell-note">
          {line.queuedFactories !== null &&
            line.queuedFactories !== 0 &&
            `Queued: ${formatProductionValue(line.queuedFactories)}`}
          {line.queuedFactories !== null &&
            line.queuedFactories !== 0 &&
            line.damagedFactories !== null &&
            line.damagedFactories !== 0 &&
            " · "}
          {line.damagedFactories !== null &&
            line.damagedFactories !== 0 &&
            `Damaged: ${formatProductionValue(line.damagedFactories)}`}
        </span>
      ) : null}
    </td>
  );
}

function EfficiencyCell({ line }: { line: MilitaryProductionLineSummary }) {
  const hasRange =
    line.activeEfficiencyMin !== null && line.activeEfficiencyMax !== null;
  return (
    <td
      className="numeric-cell"
      title="Average efficiency value across active factory slots, using HOI4's stored scale."
    >
      {formatProductionValue(line.activeEfficiencyAverage)}
      {hasRange && (
        <span className="production-cell-note">
          Range {formatProductionValue(line.activeEfficiencyMin)}–
          {formatProductionValue(line.activeEfficiencyMax)}
        </span>
      )}
    </td>
  );
}

function ResourceCell({ line }: { line: MilitaryProductionLineSummary }) {
  const { t } = useAppTranslation();
  if (!line.hasResourceShortage) {
    return <td className="production-resource-none">{t("common.none")}</td>;
  }

  return (
    <td className="production-resource-warning">
      {line.resourceShortages.map((shortage, index) => (
        <span
          className="production-shortage-item"
          key={`${shortage.resource ?? "unknown"}-${index}`}
        >
          <strong>{shortageLabel(shortage)}</strong>
          <span>
            Available: {formatProductionValue(shortage.amount)} · Need:{" "}
            {formatProductionValue(shortage.need)}
          </span>
        </span>
      ))}
    </td>
  );
}

function LinesTable({
  lines,
  unresolved = false,
}: {
  lines: MilitaryProductionLineSummary[];
  unresolved?: boolean;
}) {
  const { t } = useAppTranslation();
  return (
    <div className="table-wrap">
      <table className="recent-table production-line-table">
        <thead>
          <tr>
            <th>{t("production.design")}</th>
            <th className="numeric-cell">{t("production.activeRequested")}</th>
            <th className="numeric-cell">{t("production.currentRate")}</th>
            <th className="numeric-cell">{t("production.progress")}</th>
            <th className="numeric-cell">{t("production.efficiency")}</th>
            <th>{t("production.resources")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={lineKey(line, index)}>
              <DesignCell line={line} unresolved={unresolved} index={index} />
              <FactoriesCell line={line} />
              <td className="numeric-cell">
                {line.currentItemsPerDay === null
                  ? "—"
                  : t("production.perDay", { value: formatProductionRate(line.currentItemsPerDay) })}
              </td>
              <td
                className="numeric-cell"
                title="Progress toward the next completed item"
              >
                {formatProductionProgress(line.progressFraction)}
              </td>
              <EfficiencyCell line={line} />
              <ResourceCell line={line} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const ProductionLineTable = memo(function ProductionLineTable({
  definition,
  unresolvedLines,
}: {
  definition: MilitaryProductionDefinitionSummary | null;
  unresolvedLines: MilitaryProductionLineSummary[];
}) {
  const { t } = useAppTranslation();
  return (
    <>
      <section className="panel production-line-panel">
        {!definition ? (
          <div className="production-inner-empty">
            Select an equipment definition to inspect its current lines.
          </div>
        ) : (
          <>
            <div className="panel-head production-line-head">
              <div>
                <h2>{t("production.currentLines")}</h2>
                <div className="micro-copy">
                  {formatEquipmentDefinition(definition.equipmentDefinition)}
                </div>
              </div>
              <strong className="production-line-count">
                {definition.lineCount.toLocaleString()}
              </strong>
            </div>
            <LinesTable lines={definition.lines} />
          </>
        )}
      </section>

      {unresolvedLines.length > 0 && (
        <section className="panel production-unresolved-panel">
          <div className="panel-head">
            <div>
              <h2>{t("production.unresolvedLines")}</h2>
              <div className="micro-copy">
                Equipment definition metadata is unavailable. Raw identifiers
                are intentionally hidden.
              </div>
            </div>
          </div>
          <LinesTable lines={unresolvedLines} unresolved />
        </section>
      )}
    </>
  );
});
