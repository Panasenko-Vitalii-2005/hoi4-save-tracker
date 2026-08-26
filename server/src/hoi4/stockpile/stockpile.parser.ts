import {
  findDirectBlocks,
  readDirectScalar,
  type LocatedBlock,
} from '../naval-loss/global-history.parser';
import {
  buildCountryProductionIndex,
  type CountryProductionIndex,
} from '../country-production.index';
import { readEquipmentRef } from './equipment-registry.parser';
import {
  equipmentRefKey,
  type EquipmentDefinitionRecord,
  type EquipmentRegistryParseResult,
  type NationalStockpileRecord,
} from './stockpile.types';

function readAmount(
  saveText: string,
  block: LocatedBlock,
  warnings: string[],
): number | null {
  const raw = readDirectScalar(
    saveText,
    block.bodyStart,
    block.bodyEnd,
    'amount',
  );
  if (raw === null) {
    warnings.push('missing amount');
    return null;
  }

  const amount = Number(raw);
  if (!Number.isFinite(amount)) {
    warnings.push(`invalid amount: ${raw}`);
    return null;
  }
  return amount;
}

function createRegistryLookup(
  registry: EquipmentRegistryParseResult,
): Map<string, EquipmentDefinitionRecord> {
  const lookup = new Map<string, EquipmentDefinitionRecord>();
  for (const record of registry.records) {
    const key = equipmentRefKey(record.equipmentRef);
    if (!lookup.has(key)) lookup.set(key, record);
  }
  return lookup;
}

export function parseNationalStockpile(
  saveText: string,
  registry: EquipmentRegistryParseResult,
  topLevelBlocks?: readonly LocatedBlock[],
  countryProductionIndex?: CountryProductionIndex,
): NationalStockpileRecord[] {
  const records: NationalStockpileRecord[] = [];
  const registryLookup = createRegistryLookup(registry);
  const duplicateRegistryReferences = new Set(
    registry.duplicateReferences.map(equipmentRefKey),
  );
  const countryEntries =
    countryProductionIndex ??
    buildCountryProductionIndex(saveText, topLevelBlocks);

  for (const { countryTag, productionBlocks } of countryEntries) {
    const seenCountryReferences = new Set<string>();

    for (const productionBlock of productionBlocks) {
      const equipmentContainers = findDirectBlocks(
        saveText,
        productionBlock.bodyStart,
        productionBlock.bodyEnd,
        'equipments',
      );

      for (const equipmentsBlock of equipmentContainers) {
        const equipmentBlocks = findDirectBlocks(
          saveText,
          equipmentsBlock.bodyStart,
          equipmentsBlock.bodyEnd,
          'equipment',
        );

        for (const equipmentBlock of equipmentBlocks) {
          const warnings: string[] = [];
          if (!equipmentBlock.complete) {
            warnings.push('unterminated stockpile equipment');
          }
          const equipmentRef = readEquipmentRef(
            saveText,
            equipmentBlock,
            'id',
            warnings,
            true,
          );
          const amount = readAmount(saveText, equipmentBlock, warnings);
          let equipment: EquipmentDefinitionRecord | null = null;

          if (equipmentRef) {
            const key = equipmentRefKey(equipmentRef);
            equipment = registryLookup.get(key) ?? null;
            if (!equipment) {
              warnings.push(`unresolved equipment reference: ${key}`);
            }
            if (duplicateRegistryReferences.has(key)) {
              warnings.push(`ambiguous equipment registry reference: ${key}`);
            }
            if (seenCountryReferences.has(key)) {
              warnings.push(
                `duplicate equipment reference within ${countryTag}: ${key}`,
              );
            } else {
              seenCountryReferences.add(key);
            }
          }

          records.push({
            countryTag,
            equipmentRef,
            amount,
            equipment,
            sourceOffset: equipmentBlock.keyOffset,
            warnings,
          });
        }
      }
    }
  }

  return records;
}
