import type { EquipmentRef } from '../stockpile/stockpile.types';
import type {
  CountryDivisionSummary,
  ResolvedDivisionSummary,
} from './division.types';

export interface ArmyDivisionMembershipRecord {
  divisionRef: EquipmentRef | null;
  sourceOffset: number;
  complete: boolean;
  warnings: string[];
}

export interface ArmyRecord {
  armyRef: EquipmentRef | null;
  countryTag: string;
  name: string | null;
  commanderRef: EquipmentRef | null;
  leaderUnitRef: EquipmentRef | null;
  theaterRef: EquipmentRef | null;
  divisionMemberships: ArmyDivisionMembershipRecord[];
  sourceOffset: number;
  complete: boolean;
  warnings: string[];
}

export interface ArmyGroupMembershipRecord {
  armyRef: EquipmentRef | null;
  sourceOffset: number;
  complete: boolean;
  warnings: string[];
}

export interface ArmyGroupRecord {
  armyGroupRef: EquipmentRef | null;
  countryTag: string;
  name: string | null;
  commanderRef: EquipmentRef | null;
  theaterRef: EquipmentRef | null;
  armyMemberships: ArmyGroupMembershipRecord[];
  sourceOffset: number;
  complete: boolean;
  warnings: string[];
}

export type CommanderRole = 'corps_commander' | 'field_marshal';
export type CommanderSource = 'historical' | 'dynamic';

export interface CommanderRecord {
  commanderRef: EquipmentRef | null;
  characterRef: EquipmentRef | null;
  countryTag: string | null;
  name: string | null;
  characterName: string | null;
  role: CommanderRole;
  source: CommanderSource;
  skill: number | null;
  traits: string[];
  sourceOffset: number;
  complete: boolean;
  warnings: string[];
}

export interface ArmyHierarchyParseResult {
  armies: ArmyRecord[];
  armyGroups: ArmyGroupRecord[];
  commanders: CommanderRecord[];
}

export interface LinkedArmySummary {
  army: ArmyRecord;
  commander: CommanderRecord | null;
  parentArmyGroup: ArmyGroupRecord | null;
  divisions: ResolvedDivisionSummary[];
  unresolvedDivisionRefs: EquipmentRef[];
  ambiguousDivisionRefs: EquipmentRef[];
  complete: boolean;
  warnings: string[];
}

export interface LinkedArmyGroupSummary {
  armyGroup: ArmyGroupRecord;
  commander: CommanderRecord | null;
  armies: ArmyRecord[];
  unresolvedArmyRefs: EquipmentRef[];
  ambiguousArmyRefs: EquipmentRef[];
  complete: boolean;
  warnings: string[];
}

export interface CountryArmyHierarchySummary {
  countryTag: string;
  armies: LinkedArmySummary[];
  armyGroups: LinkedArmyGroupSummary[];
  linkedDivisionCount: number;
  unassignedDivisionCount: number;
  unassignedDivisions: ResolvedDivisionSummary[];
}

export type DivisionSummaryInput = readonly CountryDivisionSummary[];
