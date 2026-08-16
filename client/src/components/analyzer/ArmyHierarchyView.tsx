import { memo, useCallback, useState } from "react";
import type {
  ArmySummary,
  CountryArmyHierarchySummary,
  DivisionReference,
  DivisionSummary,
  DivisionTemplateCatalogEntry,
} from "@/types";
import { equipmentReferenceKey } from "@/lib/utils";

interface Props {
  hierarchy: CountryArmyHierarchySummary | null;
  divisionByRef: ReadonlyMap<string, DivisionSummary>;
  templateByRef: ReadonlyMap<string, DivisionTemplateCatalogEntry>;
  selectedDivisionKey: string | null;
  onSelectDivision: (divisionKey: string) => void;
}

function commanderText(army: {
  commander: { name: string | null; skill: number | null } | null;
}): string {
  if (!army.commander) return "Uncommanded";
  const name = army.commander.name ?? "Unnamed commander";
  return army.commander.skill === null
    ? name
    : `${name} · Skill ${army.commander.skill}`;
}

function DivisionReferenceList({
  references,
  divisionByRef,
  templateByRef,
  selectedDivisionKey,
  onSelectDivision,
}: {
  references: DivisionReference[];
  divisionByRef: ReadonlyMap<string, DivisionSummary>;
  templateByRef: ReadonlyMap<string, DivisionTemplateCatalogEntry>;
  selectedDivisionKey: string | null;
  onSelectDivision: (divisionKey: string) => void;
}) {
  if (references.length === 0) {
    return <div className="land-forces-inner-empty">No divisions.</div>;
  }

  return (
    <ul className="land-forces-hierarchy-divisions">
      {references.map((reference, index) => {
        const key = equipmentReferenceKey(reference.divisionRef);
        const division = key ? divisionByRef.get(key) : undefined;
        const templateKey = equipmentReferenceKey(
          division?.divisionTemplateRef,
        );
        const template = templateKey
          ? templateByRef.get(templateKey)
          : undefined;
        const name =
          division?.overrideName ?? template?.name ?? "Unnamed division";
        return (
          <li key={key ?? `missing-${reference.countryTag}-${index}`}>
            <button
              type="button"
              className={`land-forces-division-link${selectedDivisionKey === key ? " selected" : ""}`}
              aria-pressed={selectedDivisionKey === key}
              disabled={!key || !division}
              onClick={() => key && onSelectDivision(key)}
            >
              <span>{division ? name : "Unknown division reference"}</span>
              <small>{template?.name ?? "Template unavailable"}</small>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const ArmyBlock = memo(function ArmyBlock({
  army,
  identity,
  divisionByRef,
  templateByRef,
  selectedDivisionKey,
  onSelectDivision,
  expanded,
  onToggle,
}: {
  army: ArmySummary;
  identity: string;
  divisionByRef: ReadonlyMap<string, DivisionSummary>;
  templateByRef: ReadonlyMap<string, DivisionTemplateCatalogEntry>;
  selectedDivisionKey: string | null;
  onSelectDivision: (divisionKey: string) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const contentId = `land-forces-army-${identity.replaceAll(":", "-")}`;
  return (
    <section className="land-forces-army">
      <button
        type="button"
        className="land-forces-expand-button land-forces-army-button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={onToggle}
      >
        <span>
          <strong>{army.name ?? "Unnamed army"}</strong>
          <small>{commanderText(army)}</small>
        </span>
        <span className="land-forces-expand-meta">
          {army.divisions.length.toLocaleString()} divisions
          <b aria-hidden="true">{expanded ? "−" : "+"}</b>
        </span>
      </button>
      {expanded && (
        <div id={contentId} className="land-forces-army-content">
          <DivisionReferenceList
            references={army.divisions}
            divisionByRef={divisionByRef}
            templateByRef={templateByRef}
            selectedDivisionKey={selectedDivisionKey}
            onSelectDivision={onSelectDivision}
          />
        </div>
      )}
    </section>
  );
});

export const ArmyHierarchyView = memo(function ArmyHierarchyView({
  hierarchy,
  divisionByRef,
  templateByRef,
  selectedDivisionKey,
  onSelectDivision,
}: Props) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedArmies, setExpandedArmies] = useState<Set<string>>(
    () => new Set(),
  );

  const toggle = useCallback(
    (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => {
      setter((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [],
  );

  if (!hierarchy) {
    return (
      <div className="land-forces-inner-empty">
        No army hierarchy data was found for this country.
      </div>
    );
  }

  return (
    <div className="land-forces-hierarchy">
      {hierarchy.armyGroups.length > 0 && (
        <section className="land-forces-hierarchy-section">
          <h3>Army groups</h3>
          <div className="land-forces-group-list">
            {hierarchy.armyGroups.map((group, groupIndex) => {
              const key =
                equipmentReferenceKey(group.armyGroupRef) ??
                `missing-group-${groupIndex}`;
              const expanded = expandedGroups.has(key);
              const divisionCount = group.armies.reduce(
                (total, army) => total + army.divisions.length,
                0,
              );
              const contentId = `land-forces-group-${key.replaceAll(":", "-")}`;
              return (
                <section className="land-forces-group" key={key}>
                  <button
                    type="button"
                    className="land-forces-expand-button land-forces-group-button"
                    aria-expanded={expanded}
                    aria-controls={contentId}
                    onClick={() => toggle(setExpandedGroups, key)}
                  >
                    <span>
                      <strong>{group.name ?? "Unnamed army group"}</strong>
                      <small>{commanderText(group)}</small>
                    </span>
                    <span className="land-forces-expand-meta">
                      {group.armies.length.toLocaleString()} armies ·{" "}
                      {divisionCount.toLocaleString()} divisions
                      <b aria-hidden="true">{expanded ? "−" : "+"}</b>
                    </span>
                  </button>
                  {expanded && (
                    <div id={contentId} className="land-forces-group-content">
                      {group.armies.length === 0 ? (
                        <div className="land-forces-inner-empty">
                          No linked armies.
                        </div>
                      ) : (
                        group.armies.map((army, armyIndex) => {
                          const armyKey =
                            equipmentReferenceKey(army.armyRef) ??
                            `${key}-missing-army-${armyIndex}`;
                          return (
                            <ArmyBlock
                              key={armyKey}
                              army={army}
                              identity={armyKey}
                              divisionByRef={divisionByRef}
                              templateByRef={templateByRef}
                              selectedDivisionKey={selectedDivisionKey}
                              onSelectDivision={onSelectDivision}
                              expanded={expandedArmies.has(armyKey)}
                              onToggle={() =>
                                toggle(setExpandedArmies, armyKey)
                              }
                            />
                          );
                        })
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </section>
      )}

      {hierarchy.grouplessArmies.length > 0 && (
        <section className="land-forces-hierarchy-section">
          <h3>Groupless armies</h3>
          <div className="land-forces-group-list">
            {hierarchy.grouplessArmies.map((army, index) => {
              const key =
                equipmentReferenceKey(army.armyRef) ??
                `missing-groupless-${index}`;
              return (
                <ArmyBlock
                  key={key}
                  army={army}
                  identity={key}
                  divisionByRef={divisionByRef}
                  templateByRef={templateByRef}
                  selectedDivisionKey={selectedDivisionKey}
                  onSelectDivision={onSelectDivision}
                  expanded={expandedArmies.has(key)}
                  onToggle={() => toggle(setExpandedArmies, key)}
                />
              );
            })}
          </div>
        </section>
      )}

      <section className="land-forces-hierarchy-section">
        <h3>
          Unassigned divisions
          <span>{hierarchy.unassignedDivisionCount.toLocaleString()}</span>
        </h3>
        <DivisionReferenceList
          references={hierarchy.unassignedDivisions}
          divisionByRef={divisionByRef}
          templateByRef={templateByRef}
          selectedDivisionKey={selectedDivisionKey}
          onSelectDivision={onSelectDivision}
        />
      </section>
    </div>
  );
});
