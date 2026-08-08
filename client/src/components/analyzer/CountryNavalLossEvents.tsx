import { memo, useMemo } from "react";
import type { CountryNavalLossSummary, NavalLossEvent } from "@/types";
import {
  countryFullName,
  formatHoi4Date,
  navalShipTypeLabel,
  parseHoi4Date,
} from "@/lib/utils";

interface Props {
  summary: CountryNavalLossSummary;
  events: NavalLossEvent[];
}

function compareDatesDescending(
  left: ReturnType<typeof parseHoi4Date>,
  right: ReturnType<typeof parseHoi4Date>,
): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return (
    right.year - left.year ||
    right.month - left.month ||
    right.day - left.day ||
    right.hour - left.hour
  );
}

function shipName(name: string | null | undefined): string {
  return name?.trim() ? name : "Unnamed ship";
}

function killerLabel(event: NavalLossEvent): string {
  const killer = event.attributions.find(
    (attribution) => attribution.role === "primary_observed",
  );
  if (!killer) return "Unknown";

  const name = killer.killerName?.trim() ? killer.killerName : null;
  const country = killer.killerCountryTag?.trim() || null;
  if (name && country) return `${name} (${countryFullName(country)})`;
  if (name) return name;
  if (country) return countryFullName(country);
  return "Unknown";
}

export const CountryNavalLossEvents = memo(function CountryNavalLossEvents({
  summary,
  events,
}: Props) {
  const selectedEvents = useMemo(
    () =>
      events
        .map((event, originalIndex) => ({
          event,
          originalIndex,
          parsedDate: parseHoi4Date(event.event.date),
        }))
        .filter(({ event }) => event.sunkShip.countryTag === summary.countryTag)
        .sort(
          (left, right) =>
            compareDatesDescending(left.parsedDate, right.parsedDate) ||
            left.originalIndex - right.originalIndex,
        ),
    [events, summary.countryTag],
  );

  const countMatches = selectedEvents.length === summary.totalLost;

  return (
    <section className="panel naval-losses-events">
      <div className="panel-head">
        <h2>
          {countMatches
            ? `Individual losses — ${selectedEvents.length.toLocaleString()} ships`
            : "Individual losses"}
        </h2>
      </div>
      {!countMatches ? (
        <div className="naval-losses-inconsistent" role="alert">
          Naval loss details do not match the selected country summary.
        </div>
      ) : selectedEvents.length === 0 ? (
        <div className="naval-losses-events-empty">
          No matching logical naval-loss events were found.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="recent-table naval-losses-table naval-losses-events-table">
            <thead>
              <tr>
                <th>Ship</th>
                <th>Type</th>
                <th>Date sunk</th>
                <th>Killer</th>
              </tr>
            </thead>
            <tbody>
              {selectedEvents.map(({ event, originalIndex }) => (
                <tr key={originalIndex}>
                  <td className="ship-cell">{shipName(event.sunkShip.name)}</td>
                  <td className="type-cell">
                    {navalShipTypeLabel(event.sunkShip.definition)}
                  </td>
                  <td className="date-cell">
                    {formatHoi4Date(event.event.date)}
                  </td>
                  <td className="killer-cell">{killerLabel(event)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
});
