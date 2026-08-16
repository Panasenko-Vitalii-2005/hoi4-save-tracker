import { memo, useMemo, useState } from "react";
import type {
  DivisionSummary,
  DivisionTemplateCatalogEntry,
} from "@/types";
import {
  equipmentReferenceKey,
  formatDivisionRatio,
} from "@/lib/utils";

interface Props {
  divisions: DivisionSummary[];
  templateByRef: ReadonlyMap<string, DivisionTemplateCatalogEntry>;
  assignedRefs: ReadonlySet<string>;
  selectedDivisionKey: string | null;
  onSelectDivision: (divisionKey: string) => void;
}

function nullableNumber(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString();
}

function divisionKey(division: DivisionSummary, index: number): string {
  return (
    equipmentReferenceKey(division.divisionRef) ??
    `${division.countryTag}:missing:${index}`
  );
}

export const DivisionTable = memo(function DivisionTable({
  divisions,
  templateByRef,
  assignedRefs,
  selectedDivisionKey,
  onSelectDivision,
}: Props) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [manpower, setManpower] = useState("all");
  const [expeditionary, setExpeditionary] = useState("all");
  const [assignment, setAssignment] = useState("all");

  const roles = useMemo(
    () =>
      [
        ...new Set(
          divisions.flatMap((division) => {
            const key = equipmentReferenceKey(division.divisionTemplateRef);
            const value = key ? templateByRef.get(key)?.role : null;
            return value ? [value] : [];
          }),
        ),
      ].sort((left, right) => left.localeCompare(right)),
    [divisions, templateByRef],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return divisions
      .map((division, index) => ({ division, key: divisionKey(division, index) }))
      .filter(({ division, key }) => {
        const templateKey = equipmentReferenceKey(
          division.divisionTemplateRef,
        );
        const template = templateKey
          ? templateByRef.get(templateKey)
          : undefined;
        if (
          query &&
          !division.overrideName?.toLocaleLowerCase().includes(query) &&
          !template?.name?.toLocaleLowerCase().includes(query)
        ) {
          return false;
        }
        if (role !== "all" && template?.role !== role) return false;
        if (manpower === "full") {
          if (
            division.currentManpower === null ||
            division.requiredManpower === null ||
            division.currentManpower !== division.requiredManpower
          ) {
            return false;
          }
        }
        if (manpower === "under") {
          if (
            division.currentManpower === null ||
            division.requiredManpower === null ||
            division.currentManpower >= division.requiredManpower
          ) {
            return false;
          }
        }
        if (
          expeditionary === "yes" &&
          division.expeditionaryOwnerTag === null
        ) {
          return false;
        }
        if (
          expeditionary === "no" &&
          division.expeditionaryOwnerTag !== null
        ) {
          return false;
        }
        const assigned = assignedRefs.has(key);
        if (assignment === "assigned" && !assigned) return false;
        if (assignment === "unassigned" && assigned) return false;
        return true;
      });
  }, [
    assignedRefs,
    assignment,
    divisions,
    expeditionary,
    manpower,
    role,
    search,
    templateByRef,
  ]);

  return (
    <section className="land-forces-division-browser">
      <div className="land-forces-filter-bar">
        <label className="land-forces-search">
          <span>Search divisions</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Division or template name"
          />
        </label>
        <label>
          <span>Role</span>
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="all">All roles</option>
            {roles.map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Manpower</span>
          <select
            value={manpower}
            onChange={(event) => setManpower(event.target.value)}
          >
            <option value="all">All</option>
            <option value="full">Full</option>
            <option value="under">Under manpower</option>
          </select>
        </label>
        <label>
          <span>Provenance</span>
          <select
            value={expeditionary}
            onChange={(event) => setExpeditionary(event.target.value)}
          >
            <option value="all">All</option>
            <option value="yes">Expeditionary</option>
            <option value="no">Non-expeditionary</option>
          </select>
        </label>
        <label>
          <span>Assignment</span>
          <select
            value={assignment}
            onChange={(event) => setAssignment(event.target.value)}
          >
            <option value="all">All</option>
            <option value="assigned">Assigned</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </label>
      </div>

      <div className="land-forces-table-count">
        Showing {filtered.length.toLocaleString()} of{" "}
        {divisions.length.toLocaleString()} divisions
      </div>
      <div className="table-wrap">
        <table className="recent-table land-forces-division-table">
          <thead>
            <tr>
              <th>Division</th>
              <th>Template</th>
              <th>Role</th>
              <th className="numeric-cell">Manpower</th>
              <th className="numeric-cell">Missing</th>
              <th className="numeric-cell">Province</th>
              <th className="numeric-cell">Supply</th>
              <th>Expeditionary owner</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ division, key }) => {
              const templateKey = equipmentReferenceKey(
                division.divisionTemplateRef,
              );
              const template = templateKey
                ? templateByRef.get(templateKey)
                : undefined;
              const name =
                division.overrideName ?? template?.name ?? "Unnamed division";
              const selected = selectedDivisionKey === key;
              return (
                <tr
                  key={key}
                  className={selected ? "selected" : ""}
                  aria-selected={selected}
                  aria-label={`Inspect ${name}`}
                  tabIndex={0}
                  onClick={() => onSelectDivision(key)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectDivision(key);
                    }
                  }}
                >
                  <td className="division-cell">
                    <strong>{name}</strong>
                    {!division.complete && (
                      <span className="land-forces-muted-badge">Partial</span>
                    )}
                  </td>
                  <td className="template-cell">
                    {template?.name ?? "Template unavailable"}
                  </td>
                  <td>{template?.role ?? "—"}</td>
                  <td className="numeric-cell">
                    {nullableNumber(division.currentManpower)} /{" "}
                    {nullableNumber(division.requiredManpower)}
                  </td>
                  <td className="numeric-cell">
                    {nullableNumber(division.missingManpower)}
                  </td>
                  <td className="numeric-cell">
                    {nullableNumber(division.provinceId)}
                  </td>
                  <td className="numeric-cell">
                    {formatDivisionRatio(division.supplyRatio)}
                  </td>
                  <td>{division.expeditionaryOwnerTag ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && (
        <div className="land-forces-inner-empty">
          No divisions match the current filters.
        </div>
      )}
    </section>
  );
});
