import { memo } from "react";
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
  return (
    <section className="land-forces-composition-group">
      <h4>{title}</h4>
      {slots.length === 0 ? (
        <div className="micro-copy">None recorded</div>
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
    if (!template) {
      return (
        <section className="land-forces-template-section">
          <div className="panel-head">
            <h3>Division template</h3>
          </div>
          <div className="land-forces-inner-empty">
            Template metadata is unavailable.
            {templateRef && (
              <span className="land-forces-code">
                Reference {equipmentReferenceKey(templateRef)}
              </span>
            )}
          </div>
        </section>
      );
    }

    const metadata = [
      ["Role", template.role],
      ["Template country", formatCountryDisplayName(template.countryTag)],
      ["Original tag", formatCountryDisplayName(template.originalTag)],
      [
        "Foreign template tag",
        formatCountryDisplayName(template.foreignTemplateTag),
      ],
      ["Obsolete", template.obsolete ? "Yes" : "No"],
      ["Obsolete change date", template.obsoleteChangeDate],
      ["Record status", template.complete ? "Complete" : "Partial"],
    ] as const;

    return (
      <section className="land-forces-template-section">
        <div className="panel-head land-forces-section-head">
          <div>
            <h3>Division template</h3>
            <div className="micro-copy">
              {template.name ?? "Unnamed template"}
            </div>
          </div>
          {template.obsolete && (
            <span className="land-forces-muted-badge">Obsolete</span>
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
          <CompositionGroup title="Regiments" slots={template.regiments} />
          <CompositionGroup
            title="Support"
            slots={template.supportCompanies}
          />
          <CompositionGroup
            title="Regimental support"
            slots={template.regimentalSupport}
          />
        </div>
      </section>
    );
  },
);
