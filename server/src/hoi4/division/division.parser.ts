import {
  findDirectBlocks,
  readDirectScalar,
  type LocatedBlock,
} from '../naval-loss/global-history.parser';
import { readEquipmentRef } from '../stockpile/equipment-registry.parser';
import {
  equipmentRefKey,
  type EquipmentDefinitionRecord,
  type EquipmentRef,
  type EquipmentRegistryParseResult,
} from '../stockpile/stockpile.types';
import type {
  DivisionEquipmentRecord,
  DivisionManpower,
  DivisionNameDescriptor,
  DivisionRecord,
} from './division.types';

const COUNTRY_TAG_PATTERN = /^[A-Z][A-Z0-9]{2}$/;

function readNumber(
  saveText: string,
  block: LocatedBlock,
  field: string,
  warnings: string[],
  required: boolean,
  warningField = field,
): number | null {
  const raw = readDirectScalar(saveText, block.bodyStart, block.bodyEnd, field);
  if (raw === null) {
    if (required) warnings.push(`missing ${warningField}`);
    return null;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    warnings.push(`invalid ${warningField}: ${raw}`);
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

function readReferenceBlock(
  saveText: string,
  block: LocatedBlock,
  warningField: string,
  warnings: string[],
): EquipmentRef | null {
  if (!block.complete) warnings.push(`unterminated ${warningField}`);

  const idRaw = readDirectScalar(
    saveText,
    block.bodyStart,
    block.bodyEnd,
    'id',
  );
  const typeRaw = readDirectScalar(
    saveText,
    block.bodyStart,
    block.bodyEnd,
    'type',
  );
  let id: number | null = null;
  let type: number | null = null;

  if (idRaw === null) {
    warnings.push(`missing ${warningField}.id`);
  } else {
    const value = Number(idRaw);
    if (Number.isFinite(value) && Number.isInteger(value)) id = value;
    else warnings.push(`invalid ${warningField}.id: ${idRaw}`);
  }

  if (typeRaw === null) {
    warnings.push(`missing ${warningField}.type`);
  } else {
    const value = Number(typeRaw);
    if (Number.isFinite(value) && Number.isInteger(value)) type = value;
    else warnings.push(`invalid ${warningField}.type: ${typeRaw}`);
  }

  return id === null || type === null ? null : { id, type };
}

function readDivisionReference(
  saveText: string,
  divisionBlock: LocatedBlock,
  warnings: string[],
): EquipmentRef | null {
  const idBlocks = findDirectBlocks(
    saveText,
    divisionBlock.bodyStart,
    divisionBlock.bodyEnd,
    'id',
  );
  if (idBlocks.length === 0) {
    warnings.push('missing division id');
    return null;
  }
  if (idBlocks.length !== 2) {
    warnings.push(`expected two division id blocks, found ${idBlocks.length}`);
  }

  const references = idBlocks.map((block, index) =>
    readReferenceBlock(saveText, block, `division id[${index}]`, warnings),
  );
  const validReferences = references.filter(
    (reference): reference is EquipmentRef => reference !== null,
  );

  if (validReferences.length === 0) return null;
  if (validReferences.length === 1 && idBlocks.length > 1) {
    warnings.push('only one valid division id block');
  }

  const selected = validReferences[0];
  for (const reference of validReferences.slice(1)) {
    if (reference.id !== selected.id || reference.type !== selected.type) {
      warnings.push(
        `conflicting division id blocks: ${equipmentRefKey(selected)} vs ${equipmentRefKey(reference)}`,
      );
      break;
    }
  }
  return selected;
}

function parseNameDescriptor(
  saveText: string,
  divisionBlock: LocatedBlock,
  warnings: string[],
): DivisionNameDescriptor {
  const nameBlock = findDirectBlocks(
    saveText,
    divisionBlock.bodyStart,
    divisionBlock.bodyEnd,
    'division_name',
  )[0];
  if (!nameBlock) {
    warnings.push('missing division_name');
    return { overrideName: null, type: null, order: null };
  }
  if (!nameBlock.complete) warnings.push('unterminated division_name');

  return {
    overrideName: readDirectScalar(
      saveText,
      nameBlock.bodyStart,
      nameBlock.bodyEnd,
      'override',
    ),
    type: readNumber(
      saveText,
      nameBlock,
      'type',
      warnings,
      false,
      'division_name.type',
    ),
    order: readNumber(
      saveText,
      nameBlock,
      'name_order',
      warnings,
      false,
      'division_name.name_order',
    ),
  };
}

interface ManpowerValue {
  value: number | null;
  tag: string | null;
}

function parseManpowerValue(
  saveText: string,
  manpowerBlock: LocatedBlock,
  field: 'army_manpower_value' | 'army_manpower_need',
  warnings: string[],
): ManpowerValue {
  const container = findDirectBlocks(
    saveText,
    manpowerBlock.bodyStart,
    manpowerBlock.bodyEnd,
    field,
  )[0];
  if (!container) {
    warnings.push(`missing ${field}`);
    return { value: null, tag: null };
  }
  if (!container.complete) warnings.push(`unterminated ${field}`);

  const values = findDirectBlocks(
    saveText,
    container.bodyStart,
    container.bodyEnd,
    'value',
  );
  if (values.length === 0) {
    warnings.push(`missing ${field}.value`);
    return { value: null, tag: null };
  }
  if (values.length > 1) {
    warnings.push(`multiple ${field}.value blocks`);
  }

  const valueBlock = values[0];
  const tag = readDirectScalar(
    saveText,
    valueBlock.bodyStart,
    valueBlock.bodyEnd,
    'tag',
  );
  if (tag === null) warnings.push(`missing ${field}.value.tag`);

  return {
    value: readNumber(
      saveText,
      valueBlock,
      'value',
      warnings,
      true,
      `${field}.value.value`,
    ),
    tag,
  };
}

function parseManpower(
  saveText: string,
  divisionBlock: LocatedBlock,
  warnings: string[],
): DivisionManpower {
  const manpowerBlock = findDirectBlocks(
    saveText,
    divisionBlock.bodyStart,
    divisionBlock.bodyEnd,
    'army_manpower',
  )[0];
  if (!manpowerBlock) {
    warnings.push('missing army_manpower');
    return {
      current: null,
      required: null,
      currentTag: null,
      requiredTag: null,
    };
  }
  if (!manpowerBlock.complete) warnings.push('unterminated army_manpower');

  const current = parseManpowerValue(
    saveText,
    manpowerBlock,
    'army_manpower_value',
    warnings,
  );
  const required = parseManpowerValue(
    saveText,
    manpowerBlock,
    'army_manpower_need',
    warnings,
  );
  return {
    current: current.value,
    required: required.value,
    currentTag: current.tag,
    requiredTag: required.tag,
  };
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

function parseEquipment(
  saveText: string,
  divisionBlock: LocatedBlock,
  registryLookup: ReadonlyMap<string, EquipmentDefinitionRecord>,
  duplicateRegistryReferences: ReadonlySet<string>,
  divisionWarnings: string[],
): DivisionEquipmentRecord[] {
  const equipmentContainer = findDirectBlocks(
    saveText,
    divisionBlock.bodyStart,
    divisionBlock.bodyEnd,
    'equipment',
  )[0];
  if (!equipmentContainer) {
    divisionWarnings.push('missing equipment');
    return [];
  }
  if (!equipmentContainer.complete) {
    divisionWarnings.push('unterminated equipment');
  }

  return findDirectBlocks(
    saveText,
    equipmentContainer.bodyStart,
    equipmentContainer.bodyEnd,
    'equipment',
  ).map((equipmentBlock, index) => {
    const warnings: string[] = [];
    if (!equipmentBlock.complete) warnings.push('unterminated equipment entry');
    const equipmentRef = readEquipmentRef(
      saveText,
      equipmentBlock,
      'id',
      warnings,
      true,
    );
    const amount = readNumber(
      saveText,
      equipmentBlock,
      'amount',
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

    for (const warning of warnings) {
      divisionWarnings.push(`equipment[${index}]: ${warning}`);
    }
    return {
      equipmentRef,
      amount,
      equipment,
      sourceOffset: equipmentBlock.keyOffset,
      warnings,
    };
  });
}

function parseDivision(
  saveText: string,
  countryTag: string,
  divisionBlock: LocatedBlock,
  registryLookup: ReadonlyMap<string, EquipmentDefinitionRecord>,
  duplicateRegistryReferences: ReadonlySet<string>,
): DivisionRecord {
  const warnings: string[] = [];
  if (!divisionBlock.complete) warnings.push('unterminated division');

  const logicalCountryTag = readDirectScalar(
    saveText,
    divisionBlock.bodyStart,
    divisionBlock.bodyEnd,
    'logical_country',
  );
  if (logicalCountryTag !== null && logicalCountryTag !== countryTag) {
    warnings.push(
      `logical_country mismatch: expected ${countryTag}, got ${logicalCountryTag}`,
    );
  }

  const divisionTemplateRef = readEquipmentRef(
    saveText,
    divisionBlock,
    'division_template_id',
    warnings,
    true,
  );
  const equipment = parseEquipment(
    saveText,
    divisionBlock,
    registryLookup,
    duplicateRegistryReferences,
    warnings,
  );

  const record: DivisionRecord = {
    countryTag,
    divisionRef: readDivisionReference(saveText, divisionBlock, warnings),
    logicalCountryTag,
    expeditionaryOwnerTag: readDirectScalar(
      saveText,
      divisionBlock.bodyStart,
      divisionBlock.bodyEnd,
      'expeditionary_owner',
    ),
    name: parseNameDescriptor(saveText, divisionBlock, warnings),
    divisionTemplateRef,
    manpower: parseManpower(saveText, divisionBlock, warnings),
    strength: readNumber(saveText, divisionBlock, 'strength', warnings, true),
    organization: readNumber(
      saveText,
      divisionBlock,
      'organisation',
      warnings,
      true,
    ),
    experience: readNumber(
      saveText,
      divisionBlock,
      'experience',
      warnings,
      true,
    ),
    equipment,
    provinceId: readNumber(saveText, divisionBlock, 'location', warnings, true),
    supply: {
      current: readNumber(
        saveText,
        divisionBlock,
        'army_current_supply_ratio',
        warnings,
        true,
      ),
      max: readNumber(saveText, divisionBlock, 'max_supply', warnings, true),
      gain: readNumber(saveText, divisionBlock, 'supply_gain', warnings, true),
      outOfSupplyDays: readNumber(
        saveText,
        divisionBlock,
        'out_of_supply_days',
        warnings,
        false,
      ),
      disrupted: readNumber(
        saveText,
        divisionBlock,
        'disrupted_supply',
        warnings,
        false,
      ),
    },
    fuel: readNumber(saveText, divisionBlock, 'fuel', warnings, false),
    fuelRequested: readNumber(
      saveText,
      divisionBlock,
      'fuel_requested',
      warnings,
      false,
    ),
    status: {
      strategicRedeployment: readOptionalBoolean(
        saveText,
        divisionBlock,
        'strategic_redeployment',
        warnings,
      ),
      retreat: readOptionalBoolean(
        saveText,
        divisionBlock,
        'retreat',
        warnings,
      ),
      supportAttack: readNumber(
        saveText,
        divisionBlock,
        'support_attack',
        warnings,
        false,
      ),
    },
    sourceOffset: divisionBlock.keyOffset,
    complete: false,
    warnings,
  };
  record.complete = divisionBlock.complete && warnings.length === 0;
  return record;
}

export function parseDivisions(
  saveText: string,
  registry: EquipmentRegistryParseResult,
  topLevelBlocks?: readonly LocatedBlock[],
): DivisionRecord[] {
  const registryLookup = createRegistryLookup(registry);
  const duplicateRegistryReferences = new Set(
    registry.duplicateReferences.map(equipmentRefKey),
  );
  const records: DivisionRecord[] = [];
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

      for (const unitsBlock of findDirectBlocks(
        saveText,
        countryBlock.bodyStart,
        countryBlock.bodyEnd,
        'units',
      )) {
        for (const divisionBlock of findDirectBlocks(
          saveText,
          unitsBlock.bodyStart,
          unitsBlock.bodyEnd,
          'division',
        )) {
          records.push(
            parseDivision(
              saveText,
              countryBlock.key,
              divisionBlock,
              registryLookup,
              duplicateRegistryReferences,
            ),
          );
        }
      }
    }
  }

  return records.sort((left, right) => left.sourceOffset - right.sourceOffset);
}
