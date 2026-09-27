import type {
  CountryDivisionSummary,
  CountryFieldedEquipmentSummary,
  DivisionEquipmentCatalogEntry,
  FieldedEquipmentVariantSummary,
} from "@/types";
import { equipmentReferenceKey } from "./utils";

/** Existing persisted results have division occurrences and a catalog, but no summary. */
export function deriveLegacyFieldedEquipment(
  countries: readonly CountryDivisionSummary[],
  catalog: readonly DivisionEquipmentCatalogEntry[],
): CountryFieldedEquipmentSummary[] {
  const metadataByRef = new Map(
    catalog.map((entry) => [equipmentReferenceKey(entry.equipmentRef), entry]),
  );

  return countries.map((country) => {
    const variants = new Map<
      string,
      { metadata: DivisionEquipmentCatalogEntry; amounts: number[] }
    >();
    const unresolvedOccurrences:
      CountryFieldedEquipmentSummary["unresolvedOccurrences"] = [];
    for (const division of country.divisions) {
      for (const occurrence of division.equipment) {
        const key = equipmentReferenceKey(occurrence.equipmentRef);
        const metadata = key ? metadataByRef.get(key) : undefined;
        const amount = occurrence.amount;
        if (
          !key ||
          !metadata ||
          !metadata.definition ||
          amount === null ||
          !Number.isFinite(amount)
        ) {
          unresolvedOccurrences.push({
            equipmentRef: occurrence.equipmentRef,
            amount: amount !== null && Number.isFinite(amount) ? amount : null,
          });
          continue;
        }
        const current = variants.get(key) ?? { metadata, amounts: [] };
        current.amounts.push(amount);
        variants.set(key, current);
      }
    }

    const definitions = new Map<string, FieldedEquipmentVariantSummary[]>();
    for (const { metadata, amounts } of variants.values()) {
      const variant: FieldedEquipmentVariantSummary = {
        equipmentRef: metadata.equipmentRef,
        definition: metadata.definition,
        variantName: metadata.name,
        amount: amounts
          .sort((a, b) => a - b)
          .reduce((sum, amount) => sum + amount, 0),
        version: metadata.version,
        creatorTag: metadata.creatorTag,
        originTag: metadata.originTag,
        obsolete: metadata.obsolete,
      };
      const siblings = definitions.get(variant.definition) ?? [];
      siblings.push(variant);
      definitions.set(variant.definition, siblings);
    }

    return {
      countryTag: country.countryTag,
      definitions: [...definitions.entries()]
        .map(([definition, variants]) => {
          variants.sort(
            (a, b) =>
              a.equipmentRef.type - b.equipmentRef.type ||
              a.equipmentRef.id - b.equipmentRef.id,
          );
          return {
            definition,
            amount: variants
              .map(({ amount }) => amount)
              .sort((a, b) => a - b)
              .reduce((sum, amount) => sum + amount, 0),
            variants,
          };
        })
        .sort((a, b) => a.definition.localeCompare(b.definition)),
      unresolvedOccurrences,
    };
  });
}
