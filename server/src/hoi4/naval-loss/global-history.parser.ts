import type { ParsedNavalLoss, SaveScopedId } from './naval-loss.types';

export interface LocatedBlock {
  key: string;
  keyOffset: number;
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

export function findDirectBlocks(
  text: string,
  start: number,
  end: number,
  targetName?: string,
): LocatedBlock[] {
  const blocks: LocatedBlock[] = [];
  let offset = start;

  while (offset < end) {
    const char = text[offset];
    if (char === '"') {
      offset = skipQuotedString(text, offset, end);
      continue;
    }
    if (char === '{') {
      offset = readBracedBlock(text, offset, end).nextOffset;
      continue;
    }
    if (!isIdentifierCharacter(char)) {
      offset++;
      continue;
    }

    const keyOffset = offset;
    while (offset < end && isIdentifierCharacter(text[offset])) offset++;
    const key = text.slice(keyOffset, offset);

    while (offset < end && /\s/.test(text[offset])) offset++;
    if (text[offset] !== '=') continue;
    offset++;
    while (offset < end && /\s/.test(text[offset])) offset++;
    if (text[offset] !== '{') continue;

    const openBrace = offset;
    const block = readBracedBlock(text, openBrace, end);
    if (targetName === undefined || key === targetName) {
      blocks.push({
        key,
        keyOffset,
        bodyStart: openBrace + 1,
        bodyEnd: block.bodyEnd,
        complete: block.complete,
      });
    }
    offset = block.nextOffset;
  }

  return blocks;
}

export function readDirectScalar(
  text: string,
  start: number,
  end: number,
  targetName: string,
): string | null {
  let offset = start;
  while (offset < end) {
    if (text[offset] === '"') {
      offset = skipQuotedString(text, offset, end);
      continue;
    }
    if (text[offset] === '{') {
      offset = readBracedBlock(text, offset, end).nextOffset;
      continue;
    }
    if (!isIdentifierCharacter(text[offset])) {
      offset++;
      continue;
    }

    const keyOffset = offset;
    while (offset < end && isIdentifierCharacter(text[offset])) offset++;
    const key = text.slice(keyOffset, offset);
    while (offset < end && /\s/.test(text[offset])) offset++;
    if (text[offset] !== '=') continue;
    offset++;
    while (offset < end && /\s/.test(text[offset])) offset++;

    if (text[offset] === '{') {
      offset = readBracedBlock(text, offset, end).nextOffset;
      continue;
    }
    if (key !== targetName) continue;

    if (text[offset] === '"') {
      const valueEnd = skipQuotedString(text, offset, end);
      return valueEnd <= end
        ? text.slice(offset + 1, Math.max(offset + 1, valueEnd - 1))
        : null;
    }
    const valueStart = offset;
    while (offset < end && !/[\s{}]/.test(text[offset])) offset++;
    return text.slice(valueStart, offset) || null;
  }
  return null;
}

function readScalar(body: string, field: string): string | null {
  const pattern = new RegExp(
    `\\b${field}\\s*=\\s*(?:"((?:\\\\.|[^"\\\\])*)"|([^\\s{}]+))`,
  );
  const match = pattern.exec(body);
  return match ? (match[1] ?? match[2]) : null;
}

function readNumber(
  body: string,
  field: string,
  warnings: string[],
): number | null {
  const raw = readScalar(body, field);
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

function readRequiredString(
  body: string,
  field: string,
  warnings: string[],
): string | null {
  const value = readScalar(body, field);
  if (value === null) warnings.push(`missing ${field}`);
  return value;
}

function readBoolean(
  body: string,
  field: string,
  warnings: string[],
  required: boolean,
): boolean | null {
  const raw = readScalar(body, field);
  if (raw === null) {
    if (required) warnings.push(`missing ${field}`);
    return null;
  }
  if (raw === 'yes') return true;
  if (raw === 'no') return false;
  warnings.push(`invalid ${field}: ${raw}`);
  return null;
}

function readSaveScopedId(
  body: string,
  field: string,
  warnings: string[],
): SaveScopedId | null {
  const pattern = new RegExp(`\\b${field}\\s*=\\s*\\{([^{}]*)\\}`);
  const match = pattern.exec(body);
  if (!match) {
    warnings.push(`missing ${field}`);
    return null;
  }

  const idRaw = readScalar(match[1], 'id');
  const typeRaw = readScalar(match[1], 'type');
  const id = idRaw === null ? null : Number(idRaw);
  const type = typeRaw === null ? null : Number(typeRaw);
  const validId = id !== null && Number.isFinite(id) ? id : null;
  const validType = type !== null && Number.isFinite(type) ? type : null;

  if (validId === null || validType === null) {
    warnings.push(`incomplete ${field}`);
    return { id: validId, type: validType, status: 'incomplete' };
  }
  if (validId === 0 && validType === 0) {
    return { id: 0, type: 0, status: 'zero_sentinel' };
  }
  return { id: validId, type: validType, status: 'valid' };
}

export function parseSunkShipBlock(
  saveText: string,
  block: LocatedBlock,
  ordinal: number,
  source: ParsedNavalLoss['source'] = 'global_history',
  sourcePath = 'history.sunk_ship',
  parentContextId: string | null = null,
  provenanceWarnings: string[] = [],
): ParsedNavalLoss {
  const body = saveText.slice(block.bodyStart, block.bodyEnd);
  const warnings: string[] = [...provenanceWarnings];
  if (!block.complete) warnings.push('unterminated sunk_ship block');

  const record: ParsedNavalLoss = {
    recordId: `${source}:${block.keyOffset}:${ordinal}`,
    source,
    sourceOffset: block.keyOffset,
    sourcePath,
    ordinal,
    complete: false,
    warnings,
    sunkShip: {
      name: readRequiredString(body, 'name', warnings),
      countryTag: readRequiredString(body, 'country', warnings),
      definition: readRequiredString(body, 'definition', warnings),
      level: readNumber(body, 'level', warnings),
      equipmentVariant: readSaveScopedId(body, 'equipment_variant', warnings),
    },
    attribution: {
      killerName: readRequiredString(body, 'killer_name', warnings),
      killerCountryTag: readRequiredString(body, 'killer_country', warnings),
      killerDefinition: readRequiredString(body, 'killer_definition', warnings),
      assist: readBoolean(body, 'assist', warnings, false),
    },
    event: {
      date: readRequiredString(body, 'date', warnings),
      location: readNumber(body, 'location', warnings),
      battle: readSaveScopedId(body, 'battle', warnings),
      convoyRelated: readBoolean(body, 'convoy', warnings, true),
    },
    parentContextId,
  };
  record.complete = block.complete && warnings.length === 0;
  return record;
}

export function parseGlobalNavalLossHistory(
  saveText: string,
): ParsedNavalLoss[] {
  const historyBlocks = findDirectBlocks(
    saveText,
    0,
    saveText.length,
    'history',
  );
  const sunkShipBlocks = historyBlocks.flatMap((history) =>
    findDirectBlocks(saveText, history.bodyStart, history.bodyEnd, 'sunk_ship'),
  );

  return sunkShipBlocks
    .sort((left, right) => left.keyOffset - right.keyOffset)
    .map((block, ordinal) => parseSunkShipBlock(saveText, block, ordinal));
}
