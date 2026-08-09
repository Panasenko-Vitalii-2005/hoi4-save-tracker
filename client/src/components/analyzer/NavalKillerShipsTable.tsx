import { memo } from "react";
import type { NavalKillerShipSummary } from "@/types";
import { navalShipTypeLabel } from "@/lib/utils";

export const NavalKillerShipsTable = memo(function NavalKillerShipsTable({
  ships,
}: {
  ships: NavalKillerShipSummary[];
}) {
  return (
    <section className="panel naval-killer-ships">
      <div className="panel-head">
        <h2>Safely identified killer ships</h2>
        <div className="micro-copy">{ships.length} ships</div>
      </div>
      {ships.length === 0 ? (
        <div className="naval-killer-ships-empty">
          No individual killer ships could be identified safely for this
          country.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="recent-table naval-kills-table naval-killer-ships-table">
            <thead>
              <tr>
                <th>Ship</th>
                <th>Type</th>
                <th className="numeric-cell">Credited kills</th>
              </tr>
            </thead>
            <tbody>
              {ships.map((ship) => (
                <tr key={`${ship.shipId.type}:${ship.shipId.id}`}>
                  <td className="ship-cell">
                    <strong>{ship.shipName?.trim() || "Unnamed ship"}</strong>
                  </td>
                  <td className="type-cell">
                    {navalShipTypeLabel(ship.shipDefinition)}
                  </td>
                  <td className="numeric-cell">
                    {ship.creditedKills.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
});
