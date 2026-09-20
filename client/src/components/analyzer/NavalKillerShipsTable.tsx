import { memo } from "react";
import type { NavalKillerShipSummary } from "@/types";
import { navalShipTypeLabel } from "@/lib/utils";
import { useAppTranslation } from "@/i18n";

export const NavalKillerShipsTable = memo(function NavalKillerShipsTable({
  ships,
}: {
  ships: NavalKillerShipSummary[];
}) {
  const { t } = useAppTranslation();
  return (
    <section className="panel naval-killer-ships">
      <div className="panel-head">
        <h2>{t("naval.killerShips")}</h2>
        <div className="micro-copy">{t("common.shipsCount", { count: ships.length })}</div>
      </div>
      {ships.length === 0 ? (
        <div className="naval-killer-ships-empty">
          {t("naval.noKillerShips")}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="recent-table naval-kills-table naval-killer-ships-table">
            <thead>
              <tr>
                <th>{t("naval.ship")}</th>
                <th>{t("naval.type")}</th>
                <th className="numeric-cell">{t("naval.creditedKills")}</th>
              </tr>
            </thead>
            <tbody>
              {ships.map((ship) => (
                <tr key={`${ship.shipId.type}:${ship.shipId.id}`}>
                  <td className="ship-cell">
                    <strong>{ship.shipName?.trim() || t("common.unnamedShip")}</strong>
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
