import {
  findDirectBlocks,
  readDirectScalar,
  readDirectScalars,
  type DirectScalarMap,
  type LocatedBlock,
} from '../naval-loss/global-history.parser';
import {
  equipmentRefKey,
  type EquipmentDefinitionRecord,
  type EquipmentRef,
  type EquipmentRegistryParseResult,
} from './stockpile.types';

function readOptionalNumber(
  scalars: DirectScalarMap,
  field: string,
  warnings: string[],
): number | null {
  const raw = scalars.get(field) ?? null;
  if (raw === null) return null;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    warnings.push(`invalid ${field}: ${raw}`);
    return null;
  }
  return value;
}

function readOptionalBoolean(
  scalars: DirectScalarMap,
  field: string,
  warnings: string[],
): boolean | null {
  const raw = scalars.get(field) ?? null;
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

  return parseEquipmentRefValues(
    readDirectScalar(
      saveText,
      referenceBlock.bodyStart,
      referenceBlock.bodyEnd,
      'id',
    ),
    readDirectScalar(
      saveText,
      referenceBlock.bodyStart,
      referenceBlock.bodyEnd,
      'type',
    ),
    field,
    warnings,
  );
}

function parseEquipmentRefValues(
  idRaw: string | null,
  typeRaw: string | null,
  field: string,
  warnings: string[],
): EquipmentRef | null {
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

function readIndexedEquipmentRef(
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

  const scalars = readDirectScalars(
    saveText,
    referenceBlock.bodyStart,
    referenceBlock.bodyEnd,
  );
  return parseEquipmentRefValues(
    scalars.get('id') ?? null,
    scalars.get('type') ?? null,
    field,
    warnings,
  );
}

function parseDefinition(
  saveText: string,
  block: LocatedBlock,
): EquipmentDefinitionRecord | null {
  const warnings: string[] = [];
  if (!block.complete) warnings.push('unterminated equipment definition');
  const scalars = readDirectScalars(saveText, block.bodyStart, block.bodyEnd);
  const equipmentRef = readIndexedEquipmentRef(
    saveText,
    block,
    'id',
    warnings,
    true,
  );
  if (!equipmentRef) return null;

  return {
    equipmentRef,
    definition: block.key,
    name: scalars.get('name') ?? null,
    version: readOptionalNumber(scalars, 'version', warnings),
    maxVersion: readOptionalNumber(scalars, 'max_version', warnings),
    parentEquipmentRef: readIndexedEquipmentRef(
      saveText,
      block,
      'parent_id',
      warnings,
      false,
    ),
    creatorTag: scalars.get('creator') ?? null,
    originTag: scalars.get('origin') ?? null,
    obsolete: readOptionalBoolean(scalars, 'obsolete', warnings) ?? false,
    isFrame: readOptionalBoolean(scalars, 'is_frame', warnings),
    designTeamRef: readIndexedEquipmentRef(
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
