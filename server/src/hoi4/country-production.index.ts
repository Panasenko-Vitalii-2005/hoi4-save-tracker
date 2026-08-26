import {
  findDirectBlocks,
  type LocatedBlock,
} from './naval-loss/global-history.parser';

const COUNTRY_TAG_PATTERN = /^[A-Z][A-Z0-9]{2}$/;

export interface CountryProductionBlockEntry {
  countryTag: string;
  countryBlock: LocatedBlock;
  productionBlocks: readonly LocatedBlock[];
}

export type CountryProductionIndex = readonly CountryProductionBlockEntry[];

export function buildCountryProductionIndex(
  saveText: string,
  topLevelBlocks?: readonly LocatedBlock[],
): CountryProductionIndex {
  const entries: CountryProductionBlockEntry[] = [];
  const countriesBlocks = topLevelBlocks
    ? topLevelBlocks.filter(({ key }) => key === 'countries')
    : findDirectBlocks(saveText, 0, saveText.length, 'countries');

  for (const countriesBlock of countriesBlocks) {
    for (const countryBlock of findDirectBlocks(
      saveText,
      countriesBlock.bodyStart,
      countriesBlock.bodyEnd,
    )) {
      if (!COUNTRY_TAG_PATTERN.test(countryBlock.key)) continue;

      entries.push({
        countryTag: countryBlock.key,
        countryBlock,
        productionBlocks: findDirectBlocks(
          saveText,
          countryBlock.bodyStart,
          countryBlock.bodyEnd,
          'production',
        ),
      });
    }
  }

  return entries;
}
