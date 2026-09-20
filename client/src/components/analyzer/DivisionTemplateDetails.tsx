import { memo } from "react";
import { useTranslation } from "react-i18next";
import type {
  DivisionTemplateCatalogEntry,
  DivisionTemplateUnitSlot,
  EquipmentRef,
} from "@/types";
import {
  equipmentReferenceKey,
  formatCountryDisplayName,
} from "@/lib/utils";

function CompositionGroup({
  title,
  slots,
}: {
  title: string;
  slots: DivisionTemplateUnitSlot[];
}) {
  const { t } = useTranslation();
  return (
    <section className="land-forces-composition-group">
      <h4>{title}</h4>
      {slots.length === 0 ? (
        <div className="micro-copy">{t("land.noneRecorded")}</div>
      ) : (
        <ol>
          {slots.map((slot, index) => (
            <li key={`${slot.unitType}-${slot.x}-${slot.y}-${index}`}>
              <code>{slot.unitType}</code>
              {(slot.x !== null || slot.y !== null) && (
                <span>
                  x: {slot.x ?? "—"} · y: {slot.y ?? "—"}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export const DivisionTemplateDetails = memo(
  function DivisionTemplateDetails({
    template,
    templateRef,
  }: {
    template: DivisionTemplateCatalogEntry | null;
    templateRef: EquipmentRef | null;
  }) {
    const { t } = useTranslation();
    if (!template) {
      return (
        <section className="land-forces-template-section">
          <div className="panel-head">
            <h3>{t("land.divisionTemplate")}</h3>
          </div>
          <div className="land-forces-inner-empty">
            {t("land.templateMetadataUnavailable")}
            {templateRef && (
              <span className="land-forces-code">
                {t("land.reference", { reference: equipmentReferenceKey(templateRef) })}
              </span>
            )}
          </div>
        </section>
      );
    }

    const metadata = [
      [t("land.role"), template.role],
      [t("land.templateCountry"), formatCountryDisplayName(template.countryTag)],
      [t("land.originalTag"), formatCountryDisplayName(template.originalTag)],
      [
        t("land.foreignTemplateTag"),
        formatCountryDisplayName(template.foreignTemplateTag),
      ],
      [t("common.obsolete"), template.obsolete ? t("common.yes") : t("common.no")],
      [t("land.obsoleteChangeDate"), template.obsoleteChangeDate],
      [t("land.recordStatus"), template.complete ? t("land.complete") : t("common.partial")],
    ] as const;

    return (
      <section className="land-forces-template-section">
        <div className="panel-head land-forces-section-head">
          <div>
            <h3>{t("land.divisionTemplate")}</h3>
            <div className="micro-copy">
              {template.name ?? t("land.unnamedTemplate")}
            </div>
          </div>
          {template.obsolete && (
            <span className="land-forces-muted-badge">{t("common.obsolete")}</span>
          )}
        </div>
        <dl className="land-forces-detail-grid compact">
          {metadata.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
        <div className="land-forces-composition-grid">
          <CompositionGroup title={t("land.regiments")} slots={template.regiments} />
          <CompositionGroup
            title={t("land.support")}
            slots={template.supportCompanies}
          />
          <CompositionGroup
            title={t("land.regimentalSupport")}
            slots={template.regimentalSupport}
          />
        </div>
      </section>
    );
  },
);
