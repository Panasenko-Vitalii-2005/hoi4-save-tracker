import type {
  CountryNavalLossSummary,
  NavalLossEvent,
} from './naval-loss.types';

export const UNKNOWN_NAVAL_LOSS_TYPE = 'unknown';

interface MutableCountrySummary {
  totalLost: number;
  byType: Map<string, number>;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function aggregateNavalLosses(
  events: readonly NavalLossEvent[],
): CountryNavalLossSummary[] {
  const countries = new Map<string | null, MutableCountrySummary>();

  for (const event of events) {
    const countryTag = event.sunkShip.countryTag?.trim() || null;
    const definition =
      event.sunkShip.definition?.trim() || UNKNOWN_NAVAL_LOSS_TYPE;
    let country = countries.get(countryTag);

    if (!country) {
      country = { totalLost: 0, byType: new Map<string, number>() };
      countries.set(countryTag, country);
    }

    country.totalLost += 1;
    country.byType.set(definition, (country.byType.get(definition) ?? 0) + 1);
  }

  return [...countries.entries()]
    .map(([countryTag, country]) => ({
      countryTag,
      totalLost: country.totalLost,
      byType: [...country.byType.entries()]
        .map(([definition, count]) => ({ definition, count }))
        .sort(
          (left, right) =>
            right.count - left.count ||
            compareText(left.definition, right.definition),
        ),
    }))
    .sort((left, right) => {
      const countDifference = right.totalLost - left.totalLost;
      if (countDifference !== 0) return countDifference;

      // Known tags sort lexically; the explicit unknown-country bucket is last.
      if (left.countryTag === null) return right.countryTag === null ? 0 : 1;
      if (right.countryTag === null) return -1;
      return compareText(left.countryTag, right.countryTag);
    });
}
