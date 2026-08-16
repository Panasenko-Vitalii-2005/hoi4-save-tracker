import {
  findDirectBlocks,
  readDirectScalar,
  type LocatedBlock,
} from '../naval-loss/global-history.parser';
import { readEquipmentRef } from '../stockpile/equipment-registry.parser';
import {
  equipmentRefKey,
  type EquipmentRef,
} from '../stockpile/stockpile.types';
import type { ResolvedDivisionSummary } from './division.types';
import type {
  ArmyDivisionMembershipRecord,
  ArmyGroupMembershipRecord,
  ArmyGroupRecord,
  ArmyHierarchyParseResult,
  ArmyRecord,
  CommanderRecord,
  CommanderRole,
  CommanderSource,
  CountryArmyHierarchySummary,
  DivisionSummaryInput,
  LinkedArmyGroupSummary,
  LinkedArmySummary,
} from './army.types';

const COUNTRY_TAG_PATTERN = /^[A-Z][A-Z0-9]{2}$/;

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function cloneReference(reference: EquipmentRef | null): EquipmentRef | null {
  return reference === null ? null : { ...reference };
}

function readReferenceBlock(
  saveText: string,
  block: LocatedBlock,
  field: string,
  warnings: string[],
): EquipmentRef | null {
  if (!block.complete) warnings.push(`unterminated ${field}`);
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

  if (idRaw === null) warnings.push(`missing ${field}.id`);
  else {
    const value = Number(idRaw);
    if (Number.isInteger(value)) id = value;
    else warnings.push(`invalid ${field}.id: ${idRaw}`);
  }
  if (typeRaw === null) warnings.push(`missing ${field}.type`);
  else {
    const value = Number(typeRaw);
    if (Number.isInteger(value)) type = value;
    else warnings.push(`invalid ${field}.type: ${typeRaw}`);
  }

  return id === null || type === null ? null : { id, type };
}

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

function parseIdentifierList(
  saveText: string,
  parent: LocatedBlock,
  field: string,
  warnings: string[],
): string[] {
  const block = findDirectBlocks(
    saveText,
    parent.bodyStart,
    parent.bodyEnd,
    field,
  )[0];
  if (!block) return [];
  if (!block.complete) warnings.push(`unterminated ${field}`);

  const values: string[] = [];
  const body = saveText.slice(block.bodyStart, block.bodyEnd);
  const pattern = /"((?:\\.|[^"\\])*)"|([A-Za-z0-9_.-]+)/g;
  for (const match of body.matchAll(pattern)) {
    values.push(match[1] ?? match[2]);
  }
  return values;
}

function parseDivisionMembership(
  saveText: string,
  block: LocatedBlock,
  index: number,
  armyWarnings: string[],
): ArmyDivisionMembershipRecord {
  const warnings: string[] = [];
  if (!block.complete) warnings.push('unterminated member');
  const divisionRef = readEquipmentRef(saveText, block, 'unit', warnings, true);
  for (const warning of warnings) {
    armyWarnings.push(`member[${index}]: ${warning}`);
  }
  return {
    divisionRef,
    sourceOffset: block.keyOffset,
    complete: block.complete && warnings.length === 0,
    warnings,
  };
}

function parseArmy(
  saveText: string,
  countryTag: string,
  theaterRef: EquipmentRef | null,
  theaterWarnings: readonly string[],
  block: LocatedBlock,
): ArmyRecord {
  const warnings = [...theaterWarnings];
  if (!block.complete) warnings.push('unterminated orders_group');
  const membershipBlocks = findDirectBlocks(
    saveText,
    block.bodyStart,
    block.bodyEnd,
    'member',
  );
  const divisionMemberships = membershipBlocks.map((membership, index) =>
    parseDivisionMembership(saveText, membership, index, warnings),
  );
  const record: ArmyRecord = {
    armyRef: readEquipmentRef(saveText, block, 'id', warnings, true),
    countryTag,
    name: readDirectScalar(saveText, block.bodyStart, block.bodyEnd, 'name'),
    commanderRef: readEquipmentRef(saveText, block, 'leader', warnings, false),
    leaderUnitRef: readEquipmentRef(
      saveText,
      block,
      'leader_unit',
      warnings,
      false,
    ),
    theaterRef: cloneReference(theaterRef),
    divisionMemberships,
    sourceOffset: block.keyOffset,
    complete: false,
    warnings,
  };
  record.complete = block.complete && warnings.length === 0;
  return record;
}

function parseArmyGroupMembership(
  saveText: string,
  block: LocatedBlock,
  index: number,
  groupWarnings: string[],
): ArmyGroupMembershipRecord {
  const warnings: string[] = [];
  const armyRef = readReferenceBlock(saveText, block, 'orders_group', warnings);
  for (const warning of warnings) {
    groupWarnings.push(`orders_group[${index}]: ${warning}`);
  }
  return {
    armyRef,
    sourceOffset: block.keyOffset,
    complete: block.complete && warnings.length === 0,
    warnings,
  };
}

function parseArmyGroup(
  saveText: string,
  countryTag: string,
  theaterRef: EquipmentRef | null,
  theaterWarnings: readonly string[],
  block: LocatedBlock,
): ArmyGroupRecord {
  const warnings = [...theaterWarnings];
  if (!block.complete) warnings.push('unterminated field_marshal_group');
  const memberships = findDirectBlocks(
    saveText,
    block.bodyStart,
    block.bodyEnd,
    'orders_group',
  );
  const armyMemberships = memberships.map((membership, index) =>
    parseArmyGroupMembership(saveText, membership, index, warnings),
  );
  const record: ArmyGroupRecord = {
    armyGroupRef: readEquipmentRef(saveText, block, 'id', warnings, true),
    countryTag,
    name: readDirectScalar(saveText, block.bodyStart, block.bodyEnd, 'name'),
    commanderRef: readEquipmentRef(saveText, block, 'leader', warnings, false),
    theaterRef: cloneReference(theaterRef),
    armyMemberships,
    sourceOffset: block.keyOffset,
    complete: false,
    warnings,
  };
  record.complete = block.complete && warnings.length === 0;
  return record;
}

function parseCommander(
  saveText: string,
  characterBlock: LocatedBlock,
  roleBlock: LocatedBlock,
  role: CommanderRole,
  source: CommanderSource,
): CommanderRecord {
  const warnings: string[] = [];
  if (!characterBlock.complete) warnings.push('unterminated character');
  if (!roleBlock.complete) warnings.push(`unterminated ${role}`);
  const record: CommanderRecord = {
    commanderRef: readEquipmentRef(saveText, roleBlock, 'id', warnings, true),
    characterRef: readEquipmentRef(
      saveText,
      characterBlock,
      'id',
      warnings,
      true,
    ),
    countryTag: readDirectScalar(
      saveText,
      characterBlock.bodyStart,
      characterBlock.bodyEnd,
      'country',
    ),
    name: readDirectScalar(
      saveText,
      roleBlock.bodyStart,
      roleBlock.bodyEnd,
      'name',
    ),
    characterName: readDirectScalar(
      saveText,
      characterBlock.bodyStart,
      characterBlock.bodyEnd,
      'name',
    ),
    role,
    source,
    skill: readOptionalNumber(saveText, roleBlock, 'skill', warnings),
    traits: parseIdentifierList(saveText, roleBlock, 'traits', warnings),
    sourceOffset: roleBlock.keyOffset,
    complete: false,
    warnings,
  };
  record.complete =
    characterBlock.complete && roleBlock.complete && warnings.length === 0;
  return record;
}

function markDuplicateArmyReferences(records: ArmyRecord[]): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (record.armyRef === null) continue;
    const key = equipmentRefKey(record.armyRef);
    if (seen.has(key)) {
      record.warnings.push(`duplicate army reference: ${key}`);
      record.complete = false;
    } else seen.add(key);
  }
}

function markDuplicateArmyGroupReferences(records: ArmyGroupRecord[]): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (record.armyGroupRef === null) continue;
    const key = equipmentRefKey(record.armyGroupRef);
    if (seen.has(key)) {
      record.warnings.push(`duplicate army group reference: ${key}`);
      record.complete = false;
    } else seen.add(key);
  }
}

function markDuplicateCommanderReferences(records: CommanderRecord[]): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (record.commanderRef === null) continue;
    const key = equipmentRefKey(record.commanderRef);
    if (seen.has(key)) {
      record.warnings.push(`duplicate commander reference: ${key}`);
      record.complete = false;
    } else seen.add(key);
  }
}

export function parseArmyHierarchy(
  saveText: string,
  topLevelBlocks?: readonly LocatedBlock[],
): ArmyHierarchyParseResult {
  const armies: ArmyRecord[] = [];
  const armyGroups: ArmyGroupRecord[] = [];
  const commanders: CommanderRecord[] = [];
  const top = topLevelBlocks ?? findDirectBlocks(saveText, 0, saveText.length);

  for (const countriesBlock of top.filter(({ key }) => key === 'countries')) {
    for (const countryBlock of findDirectBlocks(
      saveText,
      countriesBlock.bodyStart,
      countriesBlock.bodyEnd,
    )) {
      if (!COUNTRY_TAG_PATTERN.test(countryBlock.key)) continue;
      for (const theatersBlock of findDirectBlocks(
        saveText,
        countryBlock.bodyStart,
        countryBlock.bodyEnd,
        'theatres',
      )) {
        for (const theaterBlock of findDirectBlocks(
          saveText,
          theatersBlock.bodyStart,
          theatersBlock.bodyEnd,
          'theatre',
        )) {
          const theaterWarnings: string[] = [];
          if (!theaterBlock.complete)
            theaterWarnings.push('unterminated theatre');
          const theaterRef = readEquipmentRef(
            saveText,
            theaterBlock,
            'id',
            theaterWarnings,
            true,
          );
          for (const armyBlock of findDirectBlocks(
            saveText,
            theaterBlock.bodyStart,
            theaterBlock.bodyEnd,
            'orders_group',
          )) {
            armies.push(
              parseArmy(
                saveText,
                countryBlock.key,
                theaterRef,
                theaterWarnings,
                armyBlock,
              ),
            );
          }
          for (const groupBlock of findDirectBlocks(
            saveText,
            theaterBlock.bodyStart,
            theaterBlock.bodyEnd,
            'field_marshal_group',
          )) {
            armyGroups.push(
              parseArmyGroup(
                saveText,
                countryBlock.key,
                theaterRef,
                theaterWarnings,
                groupBlock,
              ),
            );
          }
        }
      }
    }
  }

  for (const managerBlock of top.filter(
    ({ key }) => key === 'character_manager',
  )) {
    for (const source of ['historical', 'dynamic'] as const) {
      for (const sourceBlock of findDirectBlocks(
        saveText,
        managerBlock.bodyStart,
        managerBlock.bodyEnd,
        source,
      )) {
        for (const characterBlock of findDirectBlocks(
          saveText,
          sourceBlock.bodyStart,
          sourceBlock.bodyEnd,
          'character',
        )) {
          for (const role of ['corps_commander', 'field_marshal'] as const) {
            for (const roleBlock of findDirectBlocks(
              saveText,
              characterBlock.bodyStart,
              characterBlock.bodyEnd,
              role,
            )) {
              commanders.push(
                parseCommander(
                  saveText,
                  characterBlock,
                  roleBlock,
                  role,
                  source,
                ),
              );
            }
          }
        }
      }
    }
  }

  armies.sort((left, right) => left.sourceOffset - right.sourceOffset);
  armyGroups.sort((left, right) => left.sourceOffset - right.sourceOffset);
  commanders.sort((left, right) => left.sourceOffset - right.sourceOffset);
  markDuplicateArmyReferences(armies);
  markDuplicateArmyGroupReferences(armyGroups);
  markDuplicateCommanderReferences(commanders);
  return { armies, armyGroups, commanders };
}

function buildReferenceIndex<T>(
  records: readonly T[],
  getReference: (record: T) => EquipmentRef | null,
  getOffset: (record: T) => number,
): ReadonlyMap<string, T[]> {
  const index = new Map<string, T[]>();
  for (const record of records) {
    const reference = getReference(record);
    if (reference === null) continue;
    const key = equipmentRefKey(reference);
    const matches = index.get(key) ?? [];
    matches.push(record);
    index.set(key, matches);
  }
  for (const matches of index.values()) {
    matches.sort((left, right) => getOffset(left) - getOffset(right));
  }
  return index;
}

function resolveCommander(
  reference: EquipmentRef | null,
  index: ReadonlyMap<string, CommanderRecord[]>,
  warnings: string[],
): CommanderRecord | null {
  if (reference === null) return null;
  const key = equipmentRefKey(reference);
  const matches = index.get(key) ?? [];
  if (matches.length === 0) {
    warnings.push(`unresolved commander reference: ${key}`);
    return null;
  }
  if (matches.length > 1) {
    warnings.push(
      `ambiguous commander reference: ${key}; using source offset ${matches[0].sourceOffset}`,
    );
  }
  if (!matches[0].complete) {
    warnings.push(`resolved commander is partial: ${key}`);
  }
  return matches[0];
}

function pushUniqueReference(
  references: EquipmentRef[],
  reference: EquipmentRef,
): void {
  const key = equipmentRefKey(reference);
  if (!references.some((candidate) => equipmentRefKey(candidate) === key)) {
    references.push({ ...reference });
  }
}

export function linkArmyHierarchy(
  hierarchy: ArmyHierarchyParseResult,
  divisionCountries: DivisionSummaryInput,
): CountryArmyHierarchySummary[] {
  const divisions = divisionCountries.flatMap(({ divisions }) => divisions);
  const commanderIndex = buildReferenceIndex(
    hierarchy.commanders,
    ({ commanderRef }) => commanderRef,
    ({ sourceOffset }) => sourceOffset,
  );
  const armyIndex = buildReferenceIndex(
    hierarchy.armies,
    ({ armyRef }) => armyRef,
    ({ sourceOffset }) => sourceOffset,
  );
  const divisionIndex = buildReferenceIndex(
    divisions,
    ({ divisionRef }) => divisionRef,
    ({ sourceOffset }) => sourceOffset,
  );
  const parentGroups = new Map<string, ArmyGroupRecord[]>();
  for (const group of hierarchy.armyGroups) {
    for (const membership of group.armyMemberships) {
      if (membership.armyRef === null) continue;
      const key = equipmentRefKey(membership.armyRef);
      const matches = parentGroups.get(key) ?? [];
      matches.push(group);
      parentGroups.set(key, matches);
    }
  }
  for (const matches of parentGroups.values()) {
    matches.sort((left, right) => left.sourceOffset - right.sourceOffset);
  }

  const linkedArmies = hierarchy.armies.map((army): LinkedArmySummary => {
    const warnings = [...army.warnings];
    let parentArmyGroup: ArmyGroupRecord | null = null;
    if (army.armyRef !== null) {
      const key = equipmentRefKey(army.armyRef);
      const matches = parentGroups.get(key) ?? [];
      if (matches.length > 0) parentArmyGroup = matches[0];
      if (matches.length > 1) {
        warnings.push(
          `ambiguous parent army group membership: ${key}; using source offset ${matches[0].sourceOffset}`,
        );
      }
    }
    const commander = resolveCommander(
      army.commanderRef,
      commanderIndex,
      warnings,
    );
    return {
      army,
      commander,
      parentArmyGroup,
      divisions: [],
      unresolvedDivisionRefs: [],
      ambiguousDivisionRefs: [],
      complete: false,
      warnings,
    };
  });
  const linkedArmyByRecord = new Map(
    hierarchy.armies.map((army, index) => [army, linkedArmies[index]]),
  );

  const membershipOccurrences = new Map<
    string,
    Array<{
      army: ArmyRecord;
      membership: ArmyDivisionMembershipRecord;
    }>
  >();
  for (const army of hierarchy.armies) {
    for (const membership of army.divisionMemberships) {
      if (membership.divisionRef === null) continue;
      const key = equipmentRefKey(membership.divisionRef);
      const occurrences = membershipOccurrences.get(key) ?? [];
      occurrences.push({ army, membership });
      membershipOccurrences.set(key, occurrences);
    }
  }

  const assignedDivisions = new Set<ResolvedDivisionSummary>();
  for (const [key, occurrences] of membershipOccurrences) {
    occurrences.sort(
      (left, right) =>
        left.army.sourceOffset - right.army.sourceOffset ||
        left.membership.sourceOffset - right.membership.sourceOffset,
    );
    const divisionMatches = divisionIndex.get(key) ?? [];
    const reference = occurrences[0].membership.divisionRef;
    if (reference === null) continue;

    if (divisionMatches.length === 0) {
      for (const { army } of occurrences) {
        const linked = linkedArmyByRecord.get(army);
        if (!linked) continue;
        pushUniqueReference(linked.unresolvedDivisionRefs, reference);
        const warning = `unresolved division membership reference: ${key}`;
        if (!linked.warnings.includes(warning)) linked.warnings.push(warning);
      }
      continue;
    }

    const selectedArmy = linkedArmyByRecord.get(occurrences[0].army);
    if (selectedArmy) {
      selectedArmy.divisions.push(divisionMatches[0]);
      assignedDivisions.add(divisionMatches[0]);
    }
    if (occurrences.length > 1 || divisionMatches.length > 1) {
      for (const { army } of occurrences) {
        const linked = linkedArmyByRecord.get(army);
        if (!linked) continue;
        pushUniqueReference(linked.ambiguousDivisionRefs, reference);
        const warning = `ambiguous division membership reference: ${key}; using army source offset ${occurrences[0].army.sourceOffset}`;
        if (!linked.warnings.includes(warning)) linked.warnings.push(warning);
      }
    }
  }
  for (const linked of linkedArmies) {
    linked.complete = linked.army.complete && linked.warnings.length === 0;
  }

  const linkedGroups = hierarchy.armyGroups.map(
    (armyGroup): LinkedArmyGroupSummary => {
      const warnings = [...armyGroup.warnings];
      const commander = resolveCommander(
        armyGroup.commanderRef,
        commanderIndex,
        warnings,
      );
      const armies: ArmyRecord[] = [];
      const unresolvedArmyRefs: EquipmentRef[] = [];
      const ambiguousArmyRefs: EquipmentRef[] = [];
      const seenArmyRecords = new Set<ArmyRecord>();

      for (const membership of armyGroup.armyMemberships) {
        if (membership.armyRef === null) continue;
        const key = equipmentRefKey(membership.armyRef);
        const matches = armyIndex.get(key) ?? [];
        if (matches.length === 0) {
          pushUniqueReference(unresolvedArmyRefs, membership.armyRef);
          const warning = `unresolved army group membership reference: ${key}`;
          if (!warnings.includes(warning)) warnings.push(warning);
          continue;
        }
        if (!seenArmyRecords.has(matches[0])) {
          armies.push(matches[0]);
          seenArmyRecords.add(matches[0]);
        } else {
          pushUniqueReference(ambiguousArmyRefs, membership.armyRef);
          const warning = `duplicate army group membership reference: ${key}`;
          if (!warnings.includes(warning)) warnings.push(warning);
        }
        if (matches.length > 1) {
          pushUniqueReference(ambiguousArmyRefs, membership.armyRef);
          warnings.push(
            `ambiguous army group membership reference: ${key}; using source offset ${matches[0].sourceOffset}`,
          );
        }
      }

      return {
        armyGroup,
        commander,
        armies,
        unresolvedArmyRefs,
        ambiguousArmyRefs,
        complete: armyGroup.complete && warnings.length === 0,
        warnings,
      };
    },
  );

  const countries = new Map<string, CountryArmyHierarchySummary>();
  const getCountry = (countryTag: string): CountryArmyHierarchySummary => {
    const existing = countries.get(countryTag);
    if (existing) return existing;
    const created: CountryArmyHierarchySummary = {
      countryTag,
      armies: [],
      armyGroups: [],
      linkedDivisionCount: 0,
      unassignedDivisionCount: 0,
      unassignedDivisions: [],
    };
    countries.set(countryTag, created);
    return created;
  };
  for (const division of divisions) getCountry(division.countryTag);
  for (const army of linkedArmies) {
    const country = getCountry(army.army.countryTag);
    country.armies.push(army);
    country.linkedDivisionCount += army.divisions.length;
  }
  for (const group of linkedGroups) {
    getCountry(group.armyGroup.countryTag).armyGroups.push(group);
  }
  for (const division of divisions) {
    if (assignedDivisions.has(division)) continue;
    const country = getCountry(division.countryTag);
    country.unassignedDivisions.push(division);
    country.unassignedDivisionCount++;
  }

  return [...countries.values()].sort((left, right) =>
    compareStrings(left.countryTag, right.countryTag),
  );
}
