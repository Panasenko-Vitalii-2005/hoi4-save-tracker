import {
  findDirectBlocks,
  readDirectScalar,
  type LocatedBlock,
} from '../naval-loss/global-history.parser';
import { readEquipmentRef } from '../stockpile/equipment-registry.parser';
import { equipmentRefKey } from '../stockpile/stockpile.types';
import type {
  DivisionTemplateRecord,
  DivisionTemplateUnitSlot,
} from './division.types';

function readRequiredNumber(
  saveText: string,
  block: LocatedBlock,
  field: string,
  warnings: string[],
): number | null {
  const raw = readDirectScalar(saveText, block.bodyStart, block.bodyEnd, field);
  if (raw === null) {
    warnings.push(`missing ${field}`);
    return null;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    warnings.push(`invalid ${field}: ${raw}`);
    return null;
  }
  return value;
}

function readObsolete(
  saveText: string,
  block: LocatedBlock,
  warnings: string[],
): boolean {
  const raw = readDirectScalar(
    saveText,
    block.bodyStart,
    block.bodyEnd,
    'obsolete',
  );
  if (raw === null || raw === 'no') return false;
  if (raw === 'yes') return true;
  warnings.push(`invalid obsolete: ${raw}`);
  return false;
}

function readObsoleteDate(
  saveText: string,
  block: LocatedBlock,
  warnings: string[],
): string | null {
  const raw = readDirectScalar(
    saveText,
    block.bodyStart,
    block.bodyEnd,
    'obsolete_change_date',
  );
  if (raw === null) return null;
  if (/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(raw)) return raw;
  warnings.push(`invalid obsolete_change_date: ${raw}`);
  return null;
}

function parseUnitSlots(
  saveText: string,
  templateBlock: LocatedBlock,
  containerName: string,
  templateWarnings: string[],
): DivisionTemplateUnitSlot[] {
  const slots: DivisionTemplateUnitSlot[] = [];
  const containers = findDirectBlocks(
    saveText,
    templateBlock.bodyStart,
    templateBlock.bodyEnd,
    containerName,
  );

  for (const container of containers) {
    if (!container.complete) {
      templateWarnings.push(`unterminated ${containerName}`);
    }
    for (const slotBlock of findDirectBlocks(
      saveText,
      container.bodyStart,
      container.bodyEnd,
    )) {
      const warnings: string[] = [];
      if (!slotBlock.complete) {
        warnings.push(`unterminated ${containerName} slot`);
      }
      const slot: DivisionTemplateUnitSlot = {
        unitType: slotBlock.key,
        x: readRequiredNumber(saveText, slotBlock, 'x', warnings),
        y: readRequiredNumber(saveText, slotBlock, 'y', warnings),
        sourceOffset: slotBlock.keyOffset,
        warnings,
      };
      const slotIndex = slots.length;
      slots.push(slot);
      for (const warning of warnings) {
        templateWarnings.push(`${containerName}[${slotIndex}]: ${warning}`);
      }
    }
  }

  return slots;
}

function parseTemplate(
  saveText: string,
  block: LocatedBlock,
): DivisionTemplateRecord {
  const warnings: string[] = [];
  if (!block.complete) warnings.push('unterminated division_template');

  const countryTag = readDirectScalar(
    saveText,
    block.bodyStart,
    block.bodyEnd,
    'country',
  );
  if (countryTag === null) warnings.push('missing country');

  const record: DivisionTemplateRecord = {
    templateRef: readEquipmentRef(saveText, block, 'id', warnings, true),
    name: readDirectScalar(saveText, block.bodyStart, block.bodyEnd, 'name'),
    countryTag,
    originalTag: readDirectScalar(
      saveText,
      block.bodyStart,
      block.bodyEnd,
      'original_tag',
    ),
    foreignTemplateTag: readDirectScalar(
      saveText,
      block.bodyStart,
      block.bodyEnd,
      'foreign_template_tag',
    ),
    role: readDirectScalar(saveText, block.bodyStart, block.bodyEnd, 'role'),
    obsolete: readObsolete(saveText, block, warnings),
    obsoleteDate: readObsoleteDate(saveText, block, warnings),
    regiments: parseUnitSlots(saveText, block, 'regiments', warnings),
    supportCompanies: parseUnitSlots(saveText, block, 'support', warnings),
    regimentalSupport: parseUnitSlots(
      saveText,
      block,
      'regimental_support',
      warnings,
    ),
    sourceOffset: block.keyOffset,
    complete: false,
    warnings,
  };
  record.complete = block.complete && warnings.length === 0;
  return record;
}

export function parseDivisionTemplates(
  saveText: string,
  topLevelBlocks?: readonly LocatedBlock[],
): DivisionTemplateRecord[] {
  const records: DivisionTemplateRecord[] = [];
  const registryBlocks = topLevelBlocks
    ? topLevelBlocks.filter(({ key }) => key === 'division_templates')
    : findDirectBlocks(saveText, 0, saveText.length, 'division_templates');

  for (const registryBlock of registryBlocks) {
    for (const templateBlock of findDirectBlocks(
      saveText,
      registryBlock.bodyStart,
      registryBlock.bodyEnd,
      'division_template',
    )) {
      records.push(parseTemplate(saveText, templateBlock));
    }
  }

  records.sort((left, right) => left.sourceOffset - right.sourceOffset);
  const seenReferences = new Set<string>();
  for (const record of records) {
    if (record.templateRef === null) continue;
    const key = equipmentRefKey(record.templateRef);
    if (seenReferences.has(key)) {
      record.warnings.push(`duplicate template reference: ${key}`);
      record.complete = false;
    } else {
      seenReferences.add(key);
    }
  }

  return records;
}
