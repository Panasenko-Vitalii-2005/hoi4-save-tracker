import type {
  EquipmentDefinitionRecord,
  EquipmentRef,
} from '../stockpile/stockpile.types';

export interface DivisionNameDescriptor {
  overrideName: string | null;
  type: number | null;
  order: number | null;
}

export interface DivisionManpower {
  current: number | null;
  required: number | null;
  currentTag: string | null;
  requiredTag: string | null;
}

export interface DivisionEquipmentRecord {
  equipmentRef: EquipmentRef | null;
  amount: number | null;
  equipment: EquipmentDefinitionRecord | null;
  sourceOffset: number;
  warnings: string[];
}

export interface DivisionSupply {
  current: number | null;
  max: number | null;
  gain: number | null;
  outOfSupplyDays: number | null;
  disrupted: number | null;
}

export interface DivisionStatus {
  strategicRedeployment: boolean | null;
  retreat: boolean | null;
  supportAttack: number | null;
}

export interface DivisionRecord {
  countryTag: string;
  divisionRef: EquipmentRef | null;
  logicalCountryTag: string | null;
  expeditionaryOwnerTag: string | null;
  name: DivisionNameDescriptor;
  divisionTemplateRef: EquipmentRef | null;
  manpower: DivisionManpower;
  strength: number | null;
  organization: number | null;
  experience: number | null;
  equipment: DivisionEquipmentRecord[];
  provinceId: number | null;
  supply: DivisionSupply;
  fuel: number | null;
  fuelRequested: number | null;
  status: DivisionStatus;
  sourceOffset: number;
  complete: boolean;
  warnings: string[];
}
