import type { EquipmentDefinitionRecord } from '../../stockpile/stockpile.types';
import type {
  DivisionEquipmentRecord,
  DivisionRecord,
  DivisionTemplateRecord,
} from '../division.types';

export function divisionTemplate(
  overrides: Partial<DivisionTemplateRecord> = {},
): DivisionTemplateRecord {
  const template: DivisionTemplateRecord = {
    templateRef: { id: 100, type: 52 },
    name: 'Duplicate Template Name',
    countryTag: 'GER',
    originalTag: 'GER',
    foreignTemplateTag: '---',
    role: 'infantry',
    obsolete: false,
    obsoleteDate: null,
    regiments: [
      { unitType: 'infantry', x: 0, y: 0, sourceOffset: 11, warnings: [] },
      { unitType: 'infantry', x: 0, y: 1, sourceOffset: 12, warnings: [] },
    ],
    supportCompanies: [
      { unitType: 'engineer', x: 0, y: 0, sourceOffset: 13, warnings: [] },
    ],
    regimentalSupport: [
      {
        unitType: 'fire_support',
        x: 0,
        y: 0,
        sourceOffset: 14,
        warnings: [],
      },
    ],
    sourceOffset: 10,
    complete: true,
    warnings: [],
    ...overrides,
  };
  return {
    ...template,
    templateRef:
      template.templateRef === null ? null : { ...template.templateRef },
    regiments: template.regiments.map((slot) => ({
      ...slot,
      warnings: [...slot.warnings],
    })),
    supportCompanies: template.supportCompanies.map((slot) => ({
      ...slot,
      warnings: [...slot.warnings],
    })),
    regimentalSupport: template.regimentalSupport.map((slot) => ({
      ...slot,
      warnings: [...slot.warnings],
    })),
    warnings: [...template.warnings],
  };
}

export function divisionEquipmentDefinition(
  overrides: Partial<EquipmentDefinitionRecord> = {},
): EquipmentDefinitionRecord {
  const equipment: EquipmentDefinitionRecord = {
    equipmentRef: { id: 500, type: 70 },
    definition: 'infantry_equipment_2',
    name: 'Rifle Variant',
    version: 2,
    maxVersion: 2,
    parentEquipmentRef: null,
    creatorTag: 'GER',
    originTag: 'GER',
    obsolete: false,
    isFrame: false,
    designTeamRef: null,
    sourceOffset: 20,
    warnings: [],
    ...overrides,
  };
  return {
    ...equipment,
    equipmentRef: { ...equipment.equipmentRef },
    parentEquipmentRef:
      equipment.parentEquipmentRef === null
        ? null
        : { ...equipment.parentEquipmentRef },
    designTeamRef:
      equipment.designTeamRef === null ? null : { ...equipment.designTeamRef },
    warnings: [...equipment.warnings],
  };
}

export function divisionEquipment(
  overrides: Partial<DivisionEquipmentRecord> = {},
): DivisionEquipmentRecord {
  const equipmentRef = overrides.equipmentRef ?? { id: 500, type: 70 };
  const equipment =
    overrides.equipment === undefined
      ? divisionEquipmentDefinition({ equipmentRef })
      : overrides.equipment;
  return {
    equipmentRef: equipmentRef === null ? null : { ...equipmentRef },
    amount: 800,
    equipment,
    sourceOffset: 30,
    ...overrides,
    warnings: [...(overrides.warnings ?? [])],
  };
}

export function divisionRecord(
  overrides: Partial<DivisionRecord> = {},
): DivisionRecord {
  const record: DivisionRecord = {
    countryTag: 'GER',
    divisionRef: { id: 1, type: 51 },
    logicalCountryTag: 'GER',
    expeditionaryOwnerTag: null,
    name: { overrideName: 'Alpha Division', type: 0, order: null },
    divisionTemplateRef: { id: 100, type: 52 },
    manpower: {
      current: 80,
      required: 100,
      currentTag: 'GER',
      requiredTag: 'GER',
    },
    strength: 150,
    organization: 32.5,
    experience: 1200,
    equipment: [divisionEquipment()],
    provinceId: 1234,
    supply: {
      current: 80,
      max: 100,
      gain: 0.25,
      outOfSupplyDays: 2,
      disrupted: 0,
    },
    fuel: 4,
    fuelRequested: 1,
    status: {
      strategicRedeployment: false,
      retreat: false,
      supportAttack: 700,
    },
    sourceOffset: 100,
    complete: true,
    warnings: [],
    ...overrides,
  };
  return {
    ...record,
    divisionRef: record.divisionRef === null ? null : { ...record.divisionRef },
    name: { ...record.name },
    divisionTemplateRef:
      record.divisionTemplateRef === null
        ? null
        : { ...record.divisionTemplateRef },
    manpower: { ...record.manpower },
    equipment: record.equipment.map((entry) => ({
      ...entry,
      equipmentRef:
        entry.equipmentRef === null ? null : { ...entry.equipmentRef },
      equipment:
        entry.equipment === null
          ? null
          : divisionEquipmentDefinition(entry.equipment),
      warnings: [...entry.warnings],
    })),
    supply: { ...record.supply },
    status: { ...record.status },
    warnings: [...record.warnings],
  };
}

export const DIVISION_AGGREGATION_TEMPLATES = [
  divisionTemplate(),
  divisionTemplate({
    templateRef: { id: 200, type: 52 },
    countryTag: 'USA',
    originalTag: 'USA',
    role: 'armor',
    obsolete: true,
    obsoleteDate: '1944.5.1.24',
    regiments: [
      { unitType: 'medium_armor', x: 0, y: 0, sourceOffset: 21, warnings: [] },
    ],
    supportCompanies: [],
    regimentalSupport: [],
    sourceOffset: 20,
  }),
];

export const DIVISION_AGGREGATION_RECORDS = [
  divisionRecord(),
  divisionRecord({
    countryTag: 'USA',
    divisionRef: { id: 2, type: 51 },
    logicalCountryTag: 'USA',
    name: { overrideName: 'Zulu Division', type: 3, order: 9 },
    divisionTemplateRef: { id: 200, type: 52 },
    manpower: {
      current: 100,
      required: 100,
      currentTag: 'FRA',
      requiredTag: 'FRA',
    },
    expeditionaryOwnerTag: 'FRA',
    sourceOffset: 200,
  }),
];
