import type {
  EquipmentDefinitionRecord,
  EquipmentRef,
} from '../stockpile/stockpile.types';
import type {
  CommanderRecord,
  CountryArmyHierarchySummary,
  LinkedArmySummary,
} from './army.types';
import type {
  CountryDivisionSummary,
  DivisionEquipmentRecord,
  DivisionTemplateRecord,
  DivisionTemplateUnitSlot,
  ResolvedDivisionSummary,
} from './division.types';

export interface PublicEquipmentDefinition {
  equipmentRef: EquipmentRef;
  definition: string;
  name: string | null;
  version: number | null;
  maxVersion: number | null;
  parentEquipmentRef: EquipmentRef | null;
  creatorTag: string | null;
  originTag: string | null;
  obsolete: boolean;
  isFrame: boolean | null;
  designTeamRef: EquipmentRef | null;
}

export interface PublicDivisionEquipment {
  equipmentRef: EquipmentRef | null;
  amount: number | null;
  equipment: PublicEquipmentDefinition | null;
}

export interface PublicDivisionTemplateUnitSlot {
  unitType: string;
  x: number | null;
  y: number | null;
}

export interface PublicDivisionTemplate {
  templateRef: EquipmentRef | null;
  name: string | null;
  countryTag: string | null;
  originalTag: string | null;
  foreignTemplateTag: string | null;
  role: string | null;
  obsolete: boolean;
  obsoleteChangeDate: string | null;
  regiments: PublicDivisionTemplateUnitSlot[];
  supportCompanies: PublicDivisionTemplateUnitSlot[];
  regimentalSupport: PublicDivisionTemplateUnitSlot[];
  complete: boolean;
}

export interface PublicDivisionSummary {
  countryTag: string;
  divisionRef: EquipmentRef | null;
  logicalCountryTag: string | null;
  expeditionaryOwnerTag: string | null;
  overrideName: string | null;
  nameType: number | null;
  nameOrder: number | null;
  divisionTemplateRef: EquipmentRef | null;
  template: PublicDivisionTemplate | null;
  currentManpower: number | null;
  requiredManpower: number | null;
  currentManpowerTag: string | null;
  requiredManpowerTag: string | null;
  missingManpower: number | null;
  manpowerCompleteness: number | null;
  strength: number | null;
  organization: number | null;
  experience: number | null;
  equipment: PublicDivisionEquipment[];
  provinceId: number | null;
  supply: {
    current: number | null;
    max: number | null;
    gain: number | null;
    outOfSupplyDays: number | null;
    disrupted: number | null;
  };
  supplyRatio: number | null;
  fuel: number | null;
  fuelRequested: number | null;
  status: {
    strategicRedeployment: boolean | null;
    retreat: boolean | null;
    supportAttack: number | null;
  };
  complete: boolean;
}

export interface PublicCountryDivisionSummary {
  countryTag: string;
  divisionCount: number;
  resolvedTemplateCount: number;
  unresolvedTemplateCount: number;
  currentManpowerTotal: number;
  requiredManpowerTotal: number;
  missingManpowerTotal: number;
  fullManpowerDivisionCount: number;
  underManpowerDivisionCount: number;
  divisions: PublicDivisionSummary[];
}

export interface PublicCommanderSummary {
  commanderRef: EquipmentRef | null;
  name: string | null;
  countryTag: string | null;
  role: 'corps_commander' | 'field_marshal';
  skill: number | null;
  traits: string[];
}

export interface PublicDivisionReference {
  countryTag: string;
  divisionRef: EquipmentRef | null;
}

export interface PublicArmySummary {
  armyRef: EquipmentRef | null;
  name: string | null;
  commander: PublicCommanderSummary | null;
  divisions: PublicDivisionReference[];
  unresolvedDivisionRefs: EquipmentRef[];
  ambiguousDivisionRefs: EquipmentRef[];
  complete: boolean;
}

export interface PublicArmyGroupSummary {
  armyGroupRef: EquipmentRef | null;
  name: string | null;
  commander: PublicCommanderSummary | null;
  armies: PublicArmySummary[];
  unresolvedArmyRefs: EquipmentRef[];
  ambiguousArmyRefs: EquipmentRef[];
  complete: boolean;
}

export interface PublicCountryArmyHierarchySummary {
  countryTag: string;
  armyGroups: PublicArmyGroupSummary[];
  grouplessArmies: PublicArmySummary[];
  linkedDivisionCount: number;
  unassignedDivisionCount: number;
  unassignedDivisions: PublicDivisionReference[];
}

function cloneReference(reference: EquipmentRef | null): EquipmentRef | null {
  return reference === null ? null : { ...reference };
}

function toPublicEquipmentDefinition(
  equipment: EquipmentDefinitionRecord,
): PublicEquipmentDefinition {
  return {
    equipmentRef: { ...equipment.equipmentRef },
    definition: equipment.definition,
    name: equipment.name,
    version: equipment.version,
    maxVersion: equipment.maxVersion,
    parentEquipmentRef: cloneReference(equipment.parentEquipmentRef),
    creatorTag: equipment.creatorTag,
    originTag: equipment.originTag,
    obsolete: equipment.obsolete,
    isFrame: equipment.isFrame,
    designTeamRef: cloneReference(equipment.designTeamRef),
  };
}

function toPublicEquipment(
  entry: DivisionEquipmentRecord,
): PublicDivisionEquipment {
  return {
    equipmentRef: cloneReference(entry.equipmentRef),
    amount: entry.amount,
    equipment:
      entry.equipment === null
        ? null
        : toPublicEquipmentDefinition(entry.equipment),
  };
}

function toPublicTemplateSlot(
  slot: DivisionTemplateUnitSlot,
): PublicDivisionTemplateUnitSlot {
  return { unitType: slot.unitType, x: slot.x, y: slot.y };
}

function toPublicTemplate(
  template: DivisionTemplateRecord,
): PublicDivisionTemplate {
  return {
    templateRef: cloneReference(template.templateRef),
    name: template.name,
    countryTag: template.countryTag,
    originalTag: template.originalTag,
    foreignTemplateTag: template.foreignTemplateTag,
    role: template.role,
    obsolete: template.obsolete,
    obsoleteChangeDate: template.obsoleteDate,
    regiments: template.regiments.map(toPublicTemplateSlot),
    supportCompanies: template.supportCompanies.map(toPublicTemplateSlot),
    regimentalSupport: template.regimentalSupport.map(toPublicTemplateSlot),
    complete: template.complete,
  };
}

function toPublicDivision(
  division: ResolvedDivisionSummary,
): PublicDivisionSummary {
  return {
    countryTag: division.countryTag,
    divisionRef: cloneReference(division.divisionRef),
    logicalCountryTag: division.logicalCountryTag,
    expeditionaryOwnerTag: division.expeditionaryOwnerTag,
    overrideName: division.overrideName,
    nameType: division.nameType,
    nameOrder: division.nameOrder,
    divisionTemplateRef: cloneReference(division.divisionTemplateRef),
    template:
      division.template === null ? null : toPublicTemplate(division.template),
    currentManpower: division.currentManpower,
    requiredManpower: division.requiredManpower,
    currentManpowerTag: division.currentManpowerTag,
    requiredManpowerTag: division.requiredManpowerTag,
    missingManpower: division.missingManpower,
    manpowerCompleteness: division.manpowerCompleteness,
    strength: division.strength,
    organization: division.organization,
    experience: division.experience,
    equipment: division.equipment.map(toPublicEquipment),
    provinceId: division.provinceId,
    supply: { ...division.supply },
    supplyRatio: division.supplyRatio,
    fuel: division.fuel,
    fuelRequested: division.fuelRequested,
    status: { ...division.status },
    complete: division.complete,
  };
}

export function toPublicDivisionSummaries(
  countries: readonly CountryDivisionSummary[],
): PublicCountryDivisionSummary[] {
  return countries.map((country) => ({
    countryTag: country.countryTag,
    divisionCount: country.divisionCount,
    resolvedTemplateCount: country.resolvedTemplateCount,
    unresolvedTemplateCount: country.unresolvedTemplateCount,
    currentManpowerTotal: country.currentManpowerTotal,
    requiredManpowerTotal: country.requiredManpowerTotal,
    missingManpowerTotal: country.missingManpowerTotal,
    fullManpowerDivisionCount: country.fullManpowerDivisionCount,
    underManpowerDivisionCount: country.underManpowerDivisionCount,
    divisions: country.divisions.map(toPublicDivision),
  }));
}

function toPublicCommander(
  commander: CommanderRecord | null,
): PublicCommanderSummary | null {
  if (commander === null) return null;
  return {
    commanderRef: cloneReference(commander.commanderRef),
    name: commander.name ?? commander.characterName,
    countryTag: commander.countryTag,
    role: commander.role,
    skill: commander.skill,
    traits: [...commander.traits],
  };
}

function toPublicDivisionReference(
  division: ResolvedDivisionSummary,
): PublicDivisionReference {
  return {
    countryTag: division.countryTag,
    divisionRef: cloneReference(division.divisionRef),
  };
}

function toPublicArmy(army: LinkedArmySummary): PublicArmySummary {
  return {
    armyRef: cloneReference(army.army.armyRef),
    name: army.army.name,
    commander: toPublicCommander(army.commander),
    divisions: army.divisions.map(toPublicDivisionReference),
    unresolvedDivisionRefs: army.unresolvedDivisionRefs.map((reference) => ({
      ...reference,
    })),
    ambiguousDivisionRefs: army.ambiguousDivisionRefs.map((reference) => ({
      ...reference,
    })),
    complete: army.complete,
  };
}

export function toPublicArmyHierarchySummaries(
  countries: readonly CountryArmyHierarchySummary[],
): PublicCountryArmyHierarchySummary[] {
  return countries.map((country) => {
    const linkedArmyByRecord = new Map(
      country.armies.map((army) => [army.army, army]),
    );
    const assignedArmies = new Set<LinkedArmySummary>();
    const armyGroups = country.armyGroups.map((group) => {
      const armies = group.armies.flatMap((armyRecord) => {
        const army = linkedArmyByRecord.get(armyRecord);
        if (!army || army.parentArmyGroup !== group.armyGroup) return [];
        assignedArmies.add(army);
        return [toPublicArmy(army)];
      });
      return {
        armyGroupRef: cloneReference(group.armyGroup.armyGroupRef),
        name: group.armyGroup.name,
        commander: toPublicCommander(group.commander),
        armies,
        unresolvedArmyRefs: group.unresolvedArmyRefs.map((reference) => ({
          ...reference,
        })),
        ambiguousArmyRefs: group.ambiguousArmyRefs.map((reference) => ({
          ...reference,
        })),
        complete: group.complete,
      };
    });
    const grouplessArmies = country.armies
      .filter(
        (army) => army.parentArmyGroup === null && !assignedArmies.has(army),
      )
      .map(toPublicArmy);

    return {
      countryTag: country.countryTag,
      armyGroups,
      grouplessArmies,
      linkedDivisionCount: country.linkedDivisionCount,
      unassignedDivisionCount: country.unassignedDivisionCount,
      unassignedDivisions: country.unassignedDivisions.map(
        toPublicDivisionReference,
      ),
    };
  });
}
