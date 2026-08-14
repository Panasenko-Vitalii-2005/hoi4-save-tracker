import {
  findDirectBlocks,
  readDirectScalar,
  type LocatedBlock,
} from '../naval-loss/global-history.parser';
import {
  equipmentRefKey,
  type EquipmentDefinitionRecord,
  type EquipmentRef,
  type EquipmentRegistryParseResult,
} from './stockpile.types';

function readOptionalNumber(
  saveText: string,
  block: LocatedBlock,
  field: string,
  warnings: string[],
): number | null {
  const raw = readDirectScalar(saveText, block.bodyStart, block.bodyEnd, field);
  if (raw === null) return null;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    warnings.push(`invalid ${field}: ${raw}`);
    return null;
  }
  return value;
}

function readOptionalBoolean(
  saveText: string,
  block: LocatedBlock,
  field: string,
  warnings: string[],
): boolean | null {
  const raw = readDirectScalar(saveText, block.bodyStart, block.bodyEnd, field);
  if (raw === null) return null;
  if (raw === 'yes') return true;
  if (raw === 'no') return false;
  warnings.push(`invalid ${field}: ${raw}`);
  return null;
}

export function readEquipmentRef(
  saveText: string,
  parentBlock: LocatedBlock,
  field: string,
  warnings: string[],
  required: boolean,
): EquipmentRef | null {
  const referenceBlock = findDirectBlocks(
    saveText,
    parentBlock.bodyStart,
    parentBlock.bodyEnd,
    field,
  )[0];
  if (!referenceBlock) {
    if (required) warnings.push(`missing ${field}`);
    return null;
  }
  if (!referenceBlock.complete) warnings.push(`unterminated ${field}`);

  const idRaw = readDirectScalar(
    saveText,
    referenceBlock.bodyStart,
    referenceBlock.bodyEnd,
    'id',
  );
  const typeRaw = readDirectScalar(
    saveText,
    referenceBlock.bodyStart,
    referenceBlock.bodyEnd,
    'type',
  );

  let id: number | null = null;
  let type: number | null = null;
  if (idRaw === null) {
    warnings.push(`missing ${field}.id`);
  } else {
    const parsed = Number(idRaw);
    if (Number.isFinite(parsed) && Number.isInteger(parsed)) id = parsed;
    else warnings.push(`invalid ${field}.id: ${idRaw}`);
  }
  if (typeRaw === null) {
    warnings.push(`missing ${field}.type`);
  } else {
    const parsed = Number(typeRaw);
    if (Number.isFinite(parsed) && Number.isInteger(parsed)) type = parsed;
    else warnings.push(`invalid ${field}.type: ${typeRaw}`);
  }

  return id === null || type === null ? null : { id, type };
}

function parseDefinition(
  saveText: string,
  block: LocatedBlock,
): EquipmentDefinitionRecord | null {
  const warnings: string[] = [];
  if (!block.complete) warnings.push('unterminated equipment definition');
  const equipmentRef = readEquipmentRef(saveText, block, 'id', warnings, true);
  if (!equipmentRef) return null;

  return {
    equipmentRef,
    definition: block.key,
    name: readDirectScalar(saveText, block.bodyStart, block.bodyEnd, 'name'),
    version: readOptionalNumber(saveText, block, 'version', warnings),
    maxVersion: readOptionalNumber(saveText, block, 'max_version', warnings),
    parentEquipmentRef: readEquipmentRef(
      saveText,
      block,
      'parent_id',
      warnings,
      false,
    ),
    creatorTag: readDirectScalar(
      saveText,
      block.bodyStart,
      block.bodyEnd,
      'creator',
    ),
    originTag: readDirectScalar(
      saveText,
      block.bodyStart,
      block.bodyEnd,
      'origin',
    ),
    obsolete:
      readOptionalBoolean(saveText, block, 'obsolete', warnings) ?? false,
    isFrame: readOptionalBoolean(saveText, block, 'is_frame', warnings),
    designTeamRef: readEquipmentRef(
      saveText,
      block,
      'design_team',
      warnings,
      false,
    ),
    sourceOffset: block.keyOffset,
    warnings,
  };
}

export function parseEquipmentRegistry(
  saveText: string,
  topLevelBlocks?: readonly LocatedBlock[],
): EquipmentRegistryParseResult {
  const records: EquipmentDefinitionRecord[] = [];
  const duplicateReferences: EquipmentRef[] = [];
  const warnings: string[] = [];
  const seenReferences = new Set<string>();

  const registryBlocks = topLevelBlocks
    ? topLevelBlocks.filter(({ key }) => key === 'equipments')
    : findDirectBlocks(saveText, 0, saveText.length, 'equipments');

  for (const registryBlock of registryBlocks) {
    for (const definitionBlock of findDirectBlocks(
      saveText,
      registryBlock.bodyStart,
      registryBlock.bodyEnd,
    )) {
      const record = parseDefinition(saveText, definitionBlock);
      if (!record) {
        warnings.push(
          `ignored equipment definition without a valid reference at ${definitionBlock.keyOffset}`,
        );
        continue;
      }

      const key = equipmentRefKey(record.equipmentRef);
      if (seenReferences.has(key)) {
        duplicateReferences.push(record.equipmentRef);
        record.warnings.push(`duplicate equipment reference: ${key}`);
      } else {
        seenReferences.add(key);
      }
      records.push(record);
    }
  }

  return { records, duplicateReferences, warnings };
}
