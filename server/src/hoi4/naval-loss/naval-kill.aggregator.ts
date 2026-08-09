import { UNKNOWN_NAVAL_LOSS_TYPE } from './naval-loss.aggregator';
import type {
  CountryNavalKillSummary,
  CreditedNavalKill,
  NavalKillerShipSummary,
} from './naval-loss.types';

export interface NavalKillAggregationResult {
  countrySummaries: CountryNavalKillSummary[];
  killerShipSummaries: NavalKillerShipSummary[];
}

interface MutableCountrySummary {
  creditedKills: number;
  byVictimType: Map<string, number>;
}

type MutableShipSummary = NavalKillerShipSummary;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function preferredText(
  left: string | null,
  right: string | null,
): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return compareText(left, right) <= 0 ? left : right;
}

export function aggregateCreditedNavalKills(
  kills: readonly CreditedNavalKill[],
): NavalKillAggregationResult {
  const countries = new Map<string, MutableCountrySummary>();
  const killerShips = new Map<string, MutableShipSummary>();

  for (const kill of kills) {
    const countryTag = kill.killerCountryTag;
    const victimType =
      kill.sunkShip.definition?.trim() || UNKNOWN_NAVAL_LOSS_TYPE;
    let country = countries.get(countryTag);
    if (!country) {
      country = { creditedKills: 0, byVictimType: new Map() };
      countries.set(countryTag, country);
    }
    country.creditedKills += 1;
    country.byVictimType.set(
      victimType,
      (country.byVictimType.get(victimType) ?? 0) + 1,
    );

    const killerShip = kill.killerShip;
    if (!kill.shipCreditResolved || !killerShip?.identity) continue;
    const key = JSON.stringify([
      countryTag,
      killerShip.identity.id,
      killerShip.identity.type,
    ]);
    const existing = killerShips.get(key);
    if (existing) {
      existing.creditedKills += 1;
      existing.shipName = preferredText(existing.shipName, killerShip.name);
      existing.shipDefinition = preferredText(
        existing.shipDefinition,
        killerShip.definition,
      );
    } else {
      killerShips.set(key, {
        countryTag,
        shipId: { ...killerShip.identity },
        shipName: killerShip.name,
        shipDefinition: killerShip.definition,
        creditedKills: 1,
      });
    }
  }

  const countrySummaries = [...countries.entries()]
    .map(([countryTag, country]) => ({
      countryTag,
      creditedKills: country.creditedKills,
      byVictimType: [...country.byVictimType.entries()]
        .map(([definition, count]) => ({ definition, count }))
        .sort(
          (left, right) =>
            right.count - left.count ||
            compareText(left.definition, right.definition),
        ),
    }))
    .sort(
      (left, right) =>
        right.creditedKills - left.creditedKills ||
        compareText(left.countryTag, right.countryTag),
    );

  const killerShipSummaries = [...killerShips.values()]
    .map((summary) => ({ ...summary, shipId: { ...summary.shipId } }))
    .sort((left, right) => {
      const countDifference = right.creditedKills - left.creditedKills;
      if (countDifference !== 0) return countDifference;
      const countryDifference = compareText(left.countryTag, right.countryTag);
      if (countryDifference !== 0) return countryDifference;
      if (left.shipName === null) {
        if (right.shipName !== null) return 1;
      } else if (right.shipName === null) {
        return -1;
      } else {
        const nameDifference = compareText(left.shipName, right.shipName);
        if (nameDifference !== 0) return nameDifference;
      }
      return (
        left.shipId.id - right.shipId.id || left.shipId.type - right.shipId.type
      );
    });

  return { countrySummaries, killerShipSummaries };
}
