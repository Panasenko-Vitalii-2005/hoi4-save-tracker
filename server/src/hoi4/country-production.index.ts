import {
  findDirectBlocks,
  type LocatedBlock,
} from './naval-loss/global-history.parser';

const COUNTRY_TAG_PATTERN = /^[A-Z][A-Z0-9]{2}$/;

export interface CountryProductionBlockEntry {
  countryTag: string;
  countryBlock: LocatedBlock;
  productionBlocks: readonly LocatedBlock[];
  fleetBlocks: readonly LocatedBlock[];
  unitsBlocks: readonly LocatedBlock[];
}

export type CountryProductionIndex = readonly CountryProductionBlockEntry[];

export function buildCountryBlockByTag(
  index: CountryProductionIndex,
): ReadonlyMap<string, LocatedBlock> {
  const countryBlockByTag = new Map<string, LocatedBlock>();

  for (const entry of index) {
    if (!countryBlockByTag.has(entry.countryTag)) {
      countryBlockByTag.set(entry.countryTag, entry.countryBlock);
    }
  }

  return countryBlockByTag;
}

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

      const productionBlocks: LocatedBlock[] = [];
      const fleetBlocks: LocatedBlock[] = [];
      const unitsBlocks: LocatedBlock[] = [];
      for (const block of findDirectBlocks(
        saveText,
        countryBlock.bodyStart,
        countryBlock.bodyEnd,
      )) {
        if (block.key === 'production') {
          productionBlocks.push(block);
        } else if (block.key === 'fleet') {
          fleetBlocks.push(block);
        } else if (block.key === 'units') {
          unitsBlocks.push(block);
        }
      }

      entries.push({
        countryTag: countryBlock.key,
        countryBlock,
        productionBlocks,
        fleetBlocks,
        unitsBlocks,
      });
    }
  }

  return entries;
}
