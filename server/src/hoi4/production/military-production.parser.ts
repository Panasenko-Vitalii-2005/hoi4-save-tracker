import {
  findDirectBlocks,
  readDirectScalar,
  type LocatedBlock,
} from '../naval-loss/global-history.parser';
import { readEquipmentRef } from '../stockpile/equipment-registry.parser';
import {
  equipmentRefKey,
  type EquipmentDefinitionRecord,
  type EquipmentRegistryParseResult,
} from '../stockpile/stockpile.types';
import type {
  ParsedMilitaryProductionLine,
  ProductionResourceRecord,
} from './production.types';

const COUNTRY_TAG_PATTERN = /^[A-Z][A-Z0-9]{2}$/;

interface AnonymousBlock {
  bodyStart: number;
  bodyEnd: number;
  complete: boolean;
}

interface ReadBlockResult {
  bodyEnd: number;
  nextOffset: number;
  complete: boolean;
}

function isIdentifierCharacter(char: string): boolean {
  return /[A-Za-z0-9_.-]/.test(char);
}

function skipQuotedString(text: string, offset: number, end: number): number {
  let escaped = false;
  for (let index = offset + 1; index < end; index++) {
    const char = text[index];
    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '"') {
      return index + 1;
    }
  }
  return end;
}

function readBracedBlock(
  text: string,
  openBrace: number,
  end: number,
): ReadBlockResult {
  let depth = 1;
  for (let index = openBrace + 1; index < end; index++) {
    const char = text[index];
    if (char === '"') {
      index = skipQuotedString(text, index, end) - 1;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return { bodyEnd: index, nextOffset: index + 1, complete: true };
      }
    }
  }
  return { bodyEnd: end, nextOffset: end, complete: false };
}

function findDirectAnonymousBlocks(
  text: string,
  start: number,
  end: number,
): AnonymousBlock[] {
  const blocks: AnonymousBlock[] = [];
  let offset = start;

  while (offset < end) {
    const char = text[offset];
    if (char === '"') {
      offset = skipQuotedString(text, offset, end);
      continue;
    }
    if (char === '{') {
      const block = readBracedBlock(text, offset, end);
      blocks.push({
        bodyStart: offset + 1,
        bodyEnd: block.bodyEnd,
        complete: block.complete,
      });
      offset = block.nextOffset;
      continue;
    }
    if (!isIdentifierCharacter(char)) {
      offset++;
      continue;
    }

    while (offset < end && isIdentifierCharacter(text[offset])) offset++;
    while (offset < end && /\s/.test(text[offset])) offset++;
    if (text[offset] !== '=') continue;
    offset++;
    while (offset < end && /\s/.test(text[offset])) offset++;
    if (text[offset] === '{') {
      offset = readBracedBlock(text, offset, end).nextOffset;
      continue;
    }
    if (text[offset] === '"') {
      offset = skipQuotedString(text, offset, end);
      continue;
    }
    while (offset < end && !/[\s{}]/.test(text[offset])) offset++;
  }

  return blocks;
}

function readNumber(
  saveText: string,
  block: LocatedBlock,
  field: string,
  warnings: string[],
  required: boolean,
): number | null {
  const raw = readDirectScalar(saveText, block.bodyStart, block.bodyEnd, field);
  if (raw === null) {
    if (required) warnings.push(`missing ${field}`);
    return null;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    warnings.push(`invalid ${field}: ${raw}`);
    return null;
  }
  return value;
}

function parseFactoryEfficiencies(
  saveText: string,
  lineBlock: LocatedBlock,
  warnings: string[],
): number[] {
  const block = findDirectBlocks(
    saveText,
    lineBlock.bodyStart,
    lineBlock.bodyEnd,
    'factory_efficiencies',
  )[0];
  if (!block) {
    warnings.push('missing factory_efficiencies');
    return [];
  }
  if (!block.complete) warnings.push('unterminated factory_efficiencies');

  const values: number[] = [];
  const tokens = saveText
    .slice(block.bodyStart, block.bodyEnd)
    .split(/\s+/)
    .filter(Boolean);
  for (const token of tokens) {
    const value = Number(token);
    if (Number.isFinite(value)) values.push(value);
    else warnings.push(`invalid factory_efficiencies token: ${token}`);
  }
  return values;
}

function readResourceNumber(
  saveText: string,
  block: AnonymousBlock,
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

function parseResources(
  saveText: string,
  lineBlock: LocatedBlock,
  lineWarnings: string[],
): ProductionResourceRecord[] {
  const resourcesBlock = findDirectBlocks(
    saveText,
    lineBlock.bodyStart,
    lineBlock.bodyEnd,
    'resources',
  )[0];
  if (!resourcesBlock) {
    lineWarnings.push('missing resources');
    return [];
  }
  if (!resourcesBlock.complete) lineWarnings.push('unterminated resources');

  return findDirectAnonymousBlocks(
    saveText,
    resourcesBlock.bodyStart,
    resourcesBlock.bodyEnd,
  ).map((block, index) => {
    const warnings: string[] = [];
    if (!block.complete) warnings.push('unterminated resource entry');

    const body = saveText.slice(block.bodyStart, block.bodyEnd);
    if (body.trim() === '') {
      return {
        resource: null,
        amount: null,
        need: null,
        warnings: ['empty resource entry'],
      };
    }

    const resource = readDirectScalar(
      saveText,
      block.bodyStart,
      block.bodyEnd,
      'resource',
    );
    if (resource === null) warnings.push('missing resource');
    const amount = readResourceNumber(saveText, block, 'amount', warnings);
    const need = readResourceNumber(saveText, block, 'need', warnings);

    for (const warning of warnings) {
      lineWarnings.push(`resources[${index}]: ${warning}`);
    }
    return { resource, amount, need, warnings };
  });
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

function parseMilitaryLine(
  saveText: string,
  countryTag: string,
  lineBlock: LocatedBlock,
  registryLookup: ReadonlyMap<string, EquipmentDefinitionRecord>,
  duplicateRegistryReferences: ReadonlySet<string>,
): ParsedMilitaryProductionLine {
  const warnings: string[] = [];
  if (!lineBlock.complete) warnings.push('unterminated military_lines block');

  const lineRef = readEquipmentRef(saveText, lineBlock, 'id', warnings, true);
  const equipmentRef = readEquipmentRef(
    saveText,
    lineBlock,
    'equipment_variant_index',
    warnings,
    true,
  );
  let equipment: EquipmentDefinitionRecord | null = null;
  if (equipmentRef) {
    const key = equipmentRefKey(equipmentRef);
    equipment = registryLookup.get(key) ?? null;
    if (!equipment) warnings.push(`unresolved equipment reference: ${key}`);
    if (duplicateRegistryReferences.has(key)) {
      warnings.push(`ambiguous equipment registry reference: ${key}`);
    }
  }

  const record: ParsedMilitaryProductionLine = {
    countryTag,
    lineRef,
    equipmentRef,
    equipment,
    priority: readNumber(saveText, lineBlock, 'priority', warnings, true),
    amount: readNumber(saveText, lineBlock, 'amount', warnings, true),
    requestedFactories: readNumber(
      saveText,
      lineBlock,
      'requested_factories',
      warnings,
      true,
    ),
    activeFactories: readNumber(
      saveText,
      lineBlock,
      'active_factories',
      warnings,
      false,
    ),
    queuedFactories: readNumber(
      saveText,
      lineBlock,
      'queued_factories',
      warnings,
      false,
    ),
    damagedFactories: readNumber(
      saveText,
      lineBlock,
      'damaged_factories',
      warnings,
      false,
    ),
    produced: readNumber(saveText, lineBlock, 'produced', warnings, false),
    speed: readNumber(saveText, lineBlock, 'speed', warnings, false),
    cost: readNumber(saveText, lineBlock, 'cost', warnings, true),
    factoryEfficiencies: parseFactoryEfficiencies(
      saveText,
      lineBlock,
      warnings,
    ),
    resources: parseResources(saveText, lineBlock, warnings),
    industrialManufacturerRef: readEquipmentRef(
      saveText,
      lineBlock,
      'industrial_manufacturer',
      warnings,
      false,
    ),
    sourceOffset: lineBlock.keyOffset,
    complete: false,
    warnings,
  };
  record.complete = lineBlock.complete && warnings.length === 0;
  return record;
}

export function parseMilitaryProductionLines(
  saveText: string,
  registry: EquipmentRegistryParseResult,
  topLevelBlocks?: readonly LocatedBlock[],
): ParsedMilitaryProductionLine[] {
  const records: ParsedMilitaryProductionLine[] = [];
  const registryLookup = createRegistryLookup(registry);
  const duplicateRegistryReferences = new Set(
    registry.duplicateReferences.map(equipmentRefKey),
  );
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

      for (const productionBlock of findDirectBlocks(
        saveText,
        countryBlock.bodyStart,
        countryBlock.bodyEnd,
        'production',
      )) {
        for (const lineBlock of findDirectBlocks(
          saveText,
          productionBlock.bodyStart,
          productionBlock.bodyEnd,
          'military_lines',
        )) {
          records.push(
            parseMilitaryLine(
              saveText,
              countryBlock.key,
              lineBlock,
              registryLookup,
              duplicateRegistryReferences,
            ),
          );
        }
      }
    }
  }

  return records;
}
