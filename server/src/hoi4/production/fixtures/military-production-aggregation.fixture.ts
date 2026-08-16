import type { EquipmentDefinitionRecord } from '../../stockpile/stockpile.types';
import type { ParsedMilitaryProductionLine } from '../production.types';

export function productionEquipment(
  overrides: Partial<EquipmentDefinitionRecord> = {},
): EquipmentDefinitionRecord {
  const equipmentRef = overrides.equipmentRef ?? { id: 100, type: 70 };
  const equipment: EquipmentDefinitionRecord = {
    equipmentRef: { ...equipmentRef },
    definition: 'infantry_equipment_1',
    name: 'Rifle A',
    version: 1,
    maxVersion: 1,
    parentEquipmentRef: null,
    creatorTag: 'GER',
    originTag: 'GER',
    obsolete: false,
    isFrame: false,
    designTeamRef: null,
    sourceOffset: 10,
    warnings: [],
    ...overrides,
  };
  return {
    ...equipment,
    equipmentRef: { ...equipmentRef },
    warnings: [...(overrides.warnings ?? [])],
  };
}

export function productionLine(
  overrides: Partial<ParsedMilitaryProductionLine> = {},
): ParsedMilitaryProductionLine {
  const equipmentRef = overrides.equipmentRef ?? { id: 100, type: 70 };
  const equipment =
    overrides.equipment === undefined
      ? productionEquipment({ equipmentRef })
      : overrides.equipment;

  const line: ParsedMilitaryProductionLine = {
    countryTag: 'GER',
    lineRef: { id: 1, type: 56 },
    equipmentRef: { ...equipmentRef },
    equipment,
    priority: 0,
    amount: -1,
    requestedFactories: 4,
    activeFactories: 2,
    queuedFactories: null,
    damagedFactories: null,
    produced: 2,
    speed: 8,
    cost: 4,
    factoryEfficiencies: [100, 80, 40],
    resources: [{ resource: 'steel', amount: 4, need: 0, warnings: [] }],
    industrialManufacturerRef: null,
    sourceOffset: 100,
    complete: true,
    warnings: [],
    ...overrides,
  };
  return {
    ...line,
    lineRef:
      overrides.lineRef === undefined
        ? { id: 1, type: 56 }
        : overrides.lineRef === null
          ? null
          : { ...overrides.lineRef },
    equipmentRef:
      overrides.equipmentRef === null
        ? null
        : { ...(overrides.equipmentRef ?? equipmentRef) },
    equipment:
      equipment === null
        ? null
        : {
            ...equipment,
            equipmentRef: { ...equipment.equipmentRef },
            warnings: [...equipment.warnings],
          },
    factoryEfficiencies: [...(overrides.factoryEfficiencies ?? [100, 80, 40])],
    resources: (
      overrides.resources ?? [
        { resource: 'steel', amount: 4, need: 0, warnings: [] },
      ]
    ).map((resource) => ({
      ...resource,
      warnings: [...resource.warnings],
    })),
    industrialManufacturerRef:
      overrides.industrialManufacturerRef === undefined
        ? null
        : overrides.industrialManufacturerRef === null
          ? null
          : { ...overrides.industrialManufacturerRef },
    warnings: [...(overrides.warnings ?? [])],
  };
}
