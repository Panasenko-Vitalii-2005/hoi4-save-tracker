import {
  equipmentRefKey,
  type EquipmentDefinitionRecord,
  type EquipmentRef,
} from '../stockpile/stockpile.types';
import type { CountryDivisionSummary } from './division.types';

export interface FieldedEquipmentVariantSummary {
  equipmentRef: EquipmentRef;
  definition: string;
  variantName: string | null;
  amount: number;
  version: number | null;
  creatorTag: string | null;
  originTag: string | null;
  obsolete: boolean;
}

export interface FieldedEquipmentDefinitionSummary {
  definition: string;
  amount: number;
  variants: FieldedEquipmentVariantSummary[];
}

export interface UnresolvedFieldedEquipmentOccurrence {
  equipmentRef: EquipmentRef | null;
  amount: number | null;
}

export interface CountryFieldedEquipmentSummary {
  countryTag: string;
  definitions: FieldedEquipmentDefinitionSummary[];
  unresolvedOccurrences: UnresolvedFieldedEquipmentOccurrence[];
}

interface VariantAccumulator {
  equipmentRef: EquipmentRef;
  metadata: EquipmentDefinitionRecord;
  amounts: number[];
}

function sumAmounts(amounts: readonly number[]): number {
  return [...amounts]
    .sort((left, right) => left - right)
    .reduce((total, amount) => total + amount, 0);
}

function compareReferences(left: EquipmentRef, right: EquipmentRef): number {
  return left.type - right.type || left.id - right.id;
}

export function aggregateFieldedEquipment(
  countries: readonly CountryDivisionSummary[],
): CountryFieldedEquipmentSummary[] {
  return countries
    .map((country) => {
      const variantsByRef = new Map<string, VariantAccumulator>();
      const unresolvedOccurrences: UnresolvedFieldedEquipmentOccurrence[] = [];

      for (const division of country.divisions) {
        for (const occurrence of division.equipment) {
          const { equipmentRef, equipment, amount } = occurrence;
          if (
            equipmentRef === null ||
            equipment === null ||
            !equipment.definition ||
            amount === null ||
            !Number.isFinite(amount)
          ) {
            unresolvedOccurrences.push({
              equipmentRef: equipmentRef ? { ...equipmentRef } : null,
              amount:
                amount !== null && Number.isFinite(amount) ? amount : null,
            });
            continue;
          }

          const key = equipmentRefKey(equipmentRef);
          const variant = variantsByRef.get(key) ?? {
            equipmentRef: { ...equipmentRef },
            metadata: equipment,
            amounts: [],
          };
          variant.amounts.push(amount);
          variantsByRef.set(key, variant);
        }
      }

      const definitionsByKey = new Map<
        string,
        FieldedEquipmentVariantSummary[]
      >();
      for (const variant of variantsByRef.values()) {
        const { metadata } = variant;
        const resolved: FieldedEquipmentVariantSummary = {
          equipmentRef: { ...variant.equipmentRef },
          definition: metadata.definition,
          variantName: metadata.name,
          amount: sumAmounts(variant.amounts),
          version: metadata.version,
          creatorTag: metadata.creatorTag,
          originTag: metadata.originTag,
          obsolete: metadata.obsolete,
        };
        const siblings = definitionsByKey.get(resolved.definition) ?? [];
        siblings.push(resolved);
        definitionsByKey.set(resolved.definition, siblings);
      }

      const definitions = [...definitionsByKey.entries()]
        .map(([definition, variants]) => {
          variants.sort((left, right) =>
            compareReferences(left.equipmentRef, right.equipmentRef),
          );
          return {
            definition,
            amount: sumAmounts(variants.map(({ amount }) => amount)),
            variants,
          };
        })
        .sort((left, right) => left.definition.localeCompare(right.definition));

      return {
        countryTag: country.countryTag,
        definitions,
        unresolvedOccurrences,
      };
    })
    .sort((left, right) => left.countryTag.localeCompare(right.countryTag));
}
