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

export interface DivisionTemplateUnitSlot {
  unitType: string;
  x: number | null;
  y: number | null;
  sourceOffset: number;
  warnings: string[];
}

export interface DivisionTemplateRecord {
  templateRef: EquipmentRef | null;
  name: string | null;
  countryTag: string | null;
  originalTag: string | null;
  foreignTemplateTag: string | null;
  role: string | null;
  obsolete: boolean;
  obsoleteDate: string | null;
  regiments: DivisionTemplateUnitSlot[];
  supportCompanies: DivisionTemplateUnitSlot[];
  regimentalSupport: DivisionTemplateUnitSlot[];
  sourceOffset: number;
  complete: boolean;
  warnings: string[];
}

export interface ResolvedDivisionSummary {
  countryTag: string;
  divisionRef: EquipmentRef | null;
  logicalCountryTag: string | null;
  expeditionaryOwnerTag: string | null;
  overrideName: string | null;
  nameType: number | null;
  nameOrder: number | null;
  divisionTemplateRef: EquipmentRef | null;
  template: DivisionTemplateRecord | null;
  currentManpower: number | null;
  requiredManpower: number | null;
  currentManpowerTag: string | null;
  requiredManpowerTag: string | null;
  missingManpower: number | null;
  manpowerCompleteness: number | null;
  strength: number | null;
  organization: number | null;
  experience: number | null;
  equipment: DivisionEquipmentRecord[];
  provinceId: number | null;
  supply: DivisionSupply;
  supplyRatio: number | null;
  fuel: number | null;
  fuelRequested: number | null;
  status: DivisionStatus;
  sourceOffset: number;
  complete: boolean;
  warnings: string[];
}

export interface CountryDivisionSummary {
  countryTag: string;
  divisionCount: number;
  resolvedTemplateCount: number;
  unresolvedTemplateCount: number;
  currentManpowerTotal: number;
  requiredManpowerTotal: number;
  missingManpowerTotal: number;
  fullManpowerDivisionCount: number;
  underManpowerDivisionCount: number;
  divisions: ResolvedDivisionSummary[];
}
