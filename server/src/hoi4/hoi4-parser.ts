/**
 * HOI4 Save Parser
 *
 * Single source-of-truth for country statistics.
 * All per-country data flows through CountryStats.
 * Adding a new metric requires:
 *   1. Add property to CountryStats
 *   2. Fill it in analyzeSave()
 *   3. Consume it in the frontend
 */

import * as fs from 'fs';
import AdmZip from 'adm-zip';
import {
  findDirectBlocks,
  parseGlobalNavalLossHistory,
} from './naval-loss/global-history.parser';
import { aggregateCreditedNavalKills } from './naval-loss/naval-kill.aggregator';
import { resolveCreditedNavalKills } from './naval-loss/naval-kill.resolver';
import { aggregateNavalLosses } from './naval-loss/naval-loss.aggregator';
import { deduplicateNavalLosses } from './naval-loss/naval-loss.deduplicator';
import type {
  CountryNavalLossSummary,
  CountryNavalKillSummary,
  CreditedNavalKill,
  NavalKillerShipSummary,
  NavalLossEvent,
} from './naval-loss/naval-loss.types';
import { decodeSaveText } from './save-text.decoder';
import { aggregateMilitaryProduction } from './production/military-production.aggregator';
import { parseMilitaryProductionLines } from './production/military-production.parser';
import type { CountryMilitaryProductionSummary } from './production/production.types';
import { parseShipHistoryNavalLosses } from './naval-loss/ship-history.parser';
import { parseEquipmentRegistry } from './stockpile/equipment-registry.parser';
import { aggregateNationalStockpile } from './stockpile/stockpile.aggregator';
import { parseNationalStockpile } from './stockpile/stockpile.parser';
import type { CountryStockpileSummary } from './stockpile/stockpile.types';
import { aggregateDivisions } from './division/division.aggregator';
import { parseDivisions } from './division/division.parser';
import { parseDivisionTemplates } from './division/division-template.parser';
import {
  toPublicArmyHierarchySummaries,
  toPublicDivisionData,
  type PublicCountryArmyHierarchySummary,
  type PublicCountryDivisionSummary,
  type PublicDivisionTemplate,
  type PublicEquipmentDefinition,
} from './division/division.public';
import { linkArmyHierarchy, parseArmyHierarchy } from './division/army.parser';

// ── Core model (single source of truth) ─────────────────────────────────────

/**
 * All per-country statistics in one typed model.
 * Derived values (like avgManpowerPerDivision) are computed at presentation time.
 */
export interface CountryWarCasualties {
  opponentTag: string;
  startDate: string | null;
  role: 'first' | 'second';
  casualties: number;
}

export interface CountryStats {
  tag: string;
  // Land forces
  divisions: number;
  manpowerInField: number; // sum of army_manpower_value
  // Historical manpower casualties (see war_relation). This remains a raw,
  // non-aggregated placeholder and is intentionally not auto-summed.
  manpowerCasualties: number | null;
  // Per-war casualty breakdown for each bilateral war_relation entry.
  warCasualties: CountryWarCasualties[];
  calculatedWarCasualtiesTotal?: number;
  // Air force
  aircraft: number; // sum of count= in air_wings
  // Navy
  ships: number; // ship= entries inside task_forces
  // Industry (from states block)
  militaryFactories: number; // arms_factory buildings
  civilianFactories: number; // industrial_complex buildings
  dockyards: number; // dockyard buildings

  shipProductionDockyards: number;
  repairDockyards: number;
  effectiveDockyards: number;
  occupiedMilitaryFactories: number;
  subjectMilitaryFactories: number;
  subjectCivilianFactories: number;
  occupiedCivilianFactories: number;
  ownedCivilianFactories: number;
  effectiveOwnMilitaryFactories: number;
  effectiveMilitaryFactories: number;
  tradeCivilianFactories: number;
  effectiveCivilianFactories: number;
}

/** World totals mirror CountryStats without the tag. */
export type CountryTotals = Omit<CountryStats, 'tag'>;

export interface AnalyzeResult {
  game_date: string;
  file_size_mb: number;
  parse_seconds: number;
  active_countries: number;
  totals: CountryTotals;
  by_country: CountryStats[];
  equipment_by_country: Record<string, Record<string, number>>;
  world_equipment: Record<string, number>;
  stockpileSummaries: CountryStockpileSummary[];
  militaryProductionSummaries: CountryMilitaryProductionSummary[];
  divisionSummaries: PublicCountryDivisionSummary[];
  divisionTemplateCatalog: PublicDivisionTemplate[];
  divisionEquipmentCatalog: PublicEquipmentDefinition[];
  armyHierarchySummaries: PublicCountryArmyHierarchySummary[];
  navalLosses: NavalLossEvent[];
  navalLossSummaries: CountryNavalLossSummary[];
  navalKills: CreditedNavalKill[];
  navalKillSummaries: CountryNavalKillSummary[];
  navalKillerShipSummaries: NavalKillerShipSummary[];
  // Diagnostic: raw parsed war casualties entries. Populated to avoid returning
  // a potentially misleading aggregated `manpowerCasualties` until
  // deduplication is implemented.
  warCasualties?: ParsedWarCasualties[];
}

// Internal structure to hold raw parsed war casualty entries. Not used for
// aggregation yet — consumer must deduplicate/aggregate.
export interface ParsedWarCasualties {
  firstTag: string | null;
  secondTag: string | null;
  startDate: string | null;
  firstCasualties: number | null;
  secondCasualties: number | null;
  parentTag: string | null;
  sourceOffset: number;
  wargoalIds: number[];
}

// ── File reader ───────────────────────────────────────────────────────────────

function readSave(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const zip = new AdmZip(buf);
    const entries = zip.getEntries();
    if (!entries.length) return '';
    return decodeSaveText(entries[0].getData());
  }
  return decodeSaveText(buf);
}

// ── Block extractor ───────────────────────────────────────────────────────────

function extractBlock(content: string, startPos: number): [string, number] {
  let depth = 1;
  let pos = startPos;
  const len = content.length;
  while (pos < len && depth > 0) {
    const ch = content[pos];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    pos++;
  }
  return [content.slice(startPos, pos - 1), pos];
}

function allMatches(pattern: RegExp, text: string): RegExpExecArray[] {
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g',
  );
  const results: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) results.push(m);
  return results;
}

// ── Regex patterns ────────────────────────────────────────────────────────────

const DATE_RE = /date\s*=\s*"?(\d{1,4}\.\d{1,2}\.\d{1,2})/;
const COUNTRY_TAG_RE = /\n\t([A-Z][A-Z0-9]{2})=\{/g;
const UNITS_RE = /\bunits\s*=\s*\{/g;
const DIVISION_RE = /division\s*=\s*\{/g;
const OWNER_RE = /\bowner\s*=\s*"([A-Z][A-Z0-9]{2})"/g;
const FLEET_RE = /\bfleet\s*=\s*\{/g;
const TASK_FORCE_RE = /\btask_force\s*=\s*\{/g;
const SHIP_RE = /\bship\s*=\s*\{/g;
const LOGICAL_TAG_RE = /logical_country\s*=\s*"([A-Z][A-Z0-9]{2})"/;
const AIR_POOL_RE = /\bair_wing_pool\s*=\s*\{/g;
const AIR_WINGS_RE = /\bair_wings\s*=\s*\{/g;
const COUNT_RE = /\bcount\s*=\s*(\d+)/;
const TAG_IN_RE = /\btag\s*=\s*"([A-Z][A-Z0-9]{2})"/;
const ARMY_MP_RE = /\barmy_manpower\s*=\s*\{/;
const MP_VAL_RE = /\barmy_manpower_value\s*=\s*\{/;
const MP_ENTRY_RE =
  /value\s*=\s*\{\s*tag\s*=\s*"([A-Z][A-Z0-9]{2})"\s*value\s*=\s*(\d+)\s*\}/g;
const EQ_ENTRY_RE =
  /equipment\s*=\s*\{\s*id\s*=\s*\{\s*id\s*=\s*(\d+)\s*type\s*=\s*70\s*\}\s*amount\s*=\s*([\d.]+)/g;
// Industry — state entries are numeric IDs: `\n\t123={\n`, buildings are objects: `arms_factory={ level=8 }`
const STATE_ENTRY_RE = /\n\t(\d+)=\{/g; // numeric state IDs inside states={}
const OWNER_STATE_RE = /\bowner\s*=\s*"([A-Z][A-Z0-9]{2})"/;
const BUILDINGS_RE = /\bbuildings\s*=\s*\{/;
const DOCKYARD_RE = /\bdockyard\s*=\s*\{[^}]*level\s*=\s*(\d+)/;

const CONTROLLER_STATE_RE = /\bcontroller\s*=\s*"([A-Z][A-Z0-9]{2})"/;

const OCCUPIED_COUNTRY_TAG_RE =
  /\boccupied_country_tag\s*=\s*"([A-Z][A-Z0-9]{2})"/;

const COMPLIANCE_RE = /\bcompliance\s*=\s*([0-9.]+)/;

// ── Per-tag accumulator helpers ───────────────────────────────────────────────

function acc(map: Record<string, number>, key: string, delta: number) {
  map[key] = (map[key] ?? 0) + delta;
}

type IndustryState = {
  id: number;
  owner: string;
  controller: string;
  militaryFactories: number;
  healthyMilitaryFactories: number;
  civilianFactories: number;
  healthyCivilianFactories: number;
  dockyards: number;
  occupiedTag: string | null;
  compliancePercent: number;
};

type CountryIndustry = {
  militaryFactories: number;
  civilianFactories: number;
};

const NORMAL_INDUSTRY_TRANSFER_MODIFIERS: Record<
  string,
  { civilian: number; military: number }
> = {
  MAL_colonial_administration_idea: { civilian: 0.15, military: 0 },
  aloof_authority: { civilian: 0.05, military: 0 },
};

const LEGACY_TARGETED_INDUSTRY_IDEA_RE =
  /\b(?:GER_german_controlled_reichskommissariat|GER_government_general_idea|GER_reichsprotectorate_idea)\b/;
const GOVERNMENT_IN_EXILE_FACTORY_DONATION_MAX = 5;

function parseIndustryBuilding(
  buildingsBlock: string,
  name: string,
): { level: number; healthy: number } {
  const match = new RegExp(`\\b${name}\\s*=\\s*\\{`).exec(buildingsBlock);
  if (!match) return { level: 0, healthy: 0 };

  const [buildingBlock] = extractBlock(
    buildingsBlock,
    match.index + match[0].length,
  );
  const level = Number(/\blevel\s*=\s*(\d+)/.exec(buildingBlock)?.[1] ?? 0);
  const healthy = Number(
    /\bhealthy_levels\s*=\s*(\d+)/.exec(buildingBlock)?.[1] ?? level,
  );

  return { level, healthy };
}

function parseIndustryStates(statesBlock: string): IndustryState[] {
  const states: IndustryState[] = [];

  for (const sm of allMatches(STATE_ENTRY_RE, statesBlock)) {
    const stateId = Number(sm[1]);
    const [stateBlock] = extractBlock(statesBlock, sm.index + sm[0].length);

    const owner = OWNER_STATE_RE.exec(stateBlock)?.[1];
    if (!owner) continue;

    const controller = CONTROLLER_STATE_RE.exec(stateBlock)?.[1] ?? owner;
    const occupiedTag = OCCUPIED_COUNTRY_TAG_RE.exec(stateBlock)?.[1] ?? null;
    const compliancePercent = Number(COMPLIANCE_RE.exec(stateBlock)?.[1] ?? 0);

    let militaryFactories = 0;
    let healthyMilitaryFactories = 0;
    let civilianFactories = 0;
    let healthyCivilianFactories = 0;
    let dockyards = 0;

    const buildingsMatch = BUILDINGS_RE.exec(stateBlock);
    if (buildingsMatch) {
      const [buildingsBlock] = extractBlock(
        stateBlock,
        buildingsMatch.index + buildingsMatch[0].length,
      );

      const military = parseIndustryBuilding(buildingsBlock, 'arms_factory');
      const civilian = parseIndustryBuilding(
        buildingsBlock,
        'industrial_complex',
      );
      militaryFactories = military.level;
      healthyMilitaryFactories = military.healthy;
      civilianFactories = civilian.level;
      healthyCivilianFactories = civilian.healthy;
      dockyards = Number(DOCKYARD_RE.exec(buildingsBlock)?.[1] ?? 0);
    }

    states.push({
      id: stateId,
      owner,
      controller,
      militaryFactories,
      healthyMilitaryFactories,
      civilianFactories,
      healthyCivilianFactories,
      dockyards,
      occupiedTag,
      compliancePercent,
    });
  }

  return states;
}

type OccupiedIndustryGroup = {
  physicalMilitaryFactories: number;
  physicalCivilianFactories: number;
  complianceWeightedMilitaryFactories: number;
  complianceWeightedCivilianFactories: number;
  hasForeignOwnedState: boolean;
};

function calculateOccupiedIndustryByController(
  industryStates: IndustryState[],
  countriesBlock: string,
): {
  civilian: Record<string, number>;
  military: Record<string, number>;
  transferableMilitary: Record<string, number>;
} {
  const coresByTag = parseCoresByTag(countriesBlock);
  const occupationLaws = parseOccupationLawsByController(countriesBlock);
  const civilianGroupsByController: Record<
    string,
    Record<string, OccupiedIndustryGroup>
  > = {};
  const militaryGroupsByController: Record<
    string,
    Record<string, OccupiedIndustryGroup>
  > = {};

  for (const state of industryStates) {
    if (
      !state.occupiedTag ||
      (state.militaryFactories <= 0 && state.civilianFactories <= 0)
    ) {
      continue;
    }

    const occupationLaw = occupationLaws[state.controller]?.get(state.id);
    if (
      state.owner === state.controller &&
      occupationLaw === 'autonomous_occupation'
    ) {
      continue;
    }

    const compliance = state.compliancePercent / 100;
    const localFactoryFactor =
      0.25 + 0.65 * compliance + (state.compliancePercent >= 40 ? 0.1 : 0);

    const controllerCores = coresByTag[state.controller];
    const isControllerCore = controllerCores?.has(state.id) ?? false;
    const addToGroup = (
      groups: Record<string, Record<string, OccupiedIndustryGroup>>,
      key: string,
    ) => {
      groups[state.controller] ??= {};
      const group = groups[state.controller][key] ?? {
        physicalMilitaryFactories: 0,
        physicalCivilianFactories: 0,
        complianceWeightedMilitaryFactories: 0,
        complianceWeightedCivilianFactories: 0,
        hasForeignOwnedState: false,
      };
      group.physicalMilitaryFactories += state.militaryFactories;
      group.physicalCivilianFactories += state.civilianFactories;
      group.complianceWeightedMilitaryFactories +=
        state.militaryFactories * localFactoryFactor;
      group.complianceWeightedCivilianFactories +=
        state.civilianFactories * (isControllerCore ? 1 : localFactoryFactor);
      group.hasForeignOwnedState ||= state.owner !== state.controller;
      groups[state.controller][key] = group;
    };

    // CIV is rounded per occupied country. MIC uses the same joint CIV+MIC
    // rounding, but controller-owned and foreign-owned state buckets remain
    // separate in the runtime occupation accounting.
    addToGroup(civilianGroupsByController, state.occupiedTag);
    addToGroup(
      militaryGroupsByController,
      `${state.occupiedTag}:${state.owner === state.controller ? 'owned' : 'foreign'}`,
    );
  }

  const civilian: Record<string, number> = {};
  const military: Record<string, number> = {};
  const transferableMilitary: Record<string, number> = {};

  const roundedGroup = (group: OccupiedIndustryGroup) => {
    const round = group.hasForeignOwnedState ? Math.round : Math.floor;
    const total = round(
      group.complianceWeightedMilitaryFactories +
        group.complianceWeightedCivilianFactories +
        Number.EPSILON,
    );
    let civilianFactories = round(
      group.complianceWeightedCivilianFactories + Number.EPSILON,
    );
    if (group.hasForeignOwnedState && group.physicalCivilianFactories > 0) {
      civilianFactories = Math.max(1, civilianFactories);
    }
    return {
      civilian: civilianFactories,
      military: Math.max(0, total - civilianFactories),
    };
  };

  for (const [controller, occupiedCountries] of Object.entries(
    civilianGroupsByController,
  )) {
    civilian[controller] = Object.values(occupiedCountries).reduce(
      (total, group) => total + roundedGroup(group).civilian,
      0,
    );
    transferableMilitary[controller] = Object.values(occupiedCountries).reduce(
      (total, group) => {
        const roundedCivilian = Math.round(
          group.complianceWeightedCivilianFactories,
        );
        const roundedTotal = Math.round(
          group.complianceWeightedCivilianFactories +
            group.complianceWeightedMilitaryFactories,
        );
        return total + Math.max(0, roundedTotal - roundedCivilian);
      },
      0,
    );
  }

  for (const [controller, occupiedCountries] of Object.entries(
    militaryGroupsByController,
  )) {
    military[controller] = Object.values(occupiedCountries).reduce(
      (total, group) => {
        if (
          group.physicalMilitaryFactories <= 0 &&
          group.physicalCivilianFactories <= 0
        ) {
          return total;
        }
        return total + roundedGroup(group).military;
      },
      0,
    );
  }

  return { civilian, military, transferableMilitary };
}

function getDirectCountryBlock(
  countriesBlock: string,
  tag: string,
): string | null {
  let depth = 0;

  for (let i = 0; i < countriesBlock.length; i++) {
    const ch = countriesBlock[i];

    if (ch === '{') {
      depth++;
      continue;
    }

    if (ch === '}') {
      depth--;
      continue;
    }

    if (ch !== '\n' || depth !== 0) continue;

    const rest = countriesBlock.slice(i + 1);
    const match = new RegExp(`^[\\t ]*${tag}\\s*=\\s*\\{`).exec(rest);

    if (!match) continue;

    return extractBlock(rest, match.index + match[0].length)[0];
  }

  return null;
}

function getDirectNamedBlock(text: string, name: string): string | null {
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      continue;
    }
    if (depth !== 0 || (i > 0 && text[i - 1] !== '\n')) continue;

    const match = new RegExp(`^[\\t ]*${name}\\s*=\\s*\\{`).exec(text.slice(i));
    if (match) return extractBlock(text, i + match[0].length)[0];
  }

  return null;
}

function parseOccupationLawsByController(
  countriesBlock: string,
): Record<string, Map<number, string>> {
  const result: Record<string, Map<number, string>> = {};
  const countryMatches = allMatches(COUNTRY_TAG_RE, countriesBlock);

  for (let i = 0; i < countryMatches.length; i++) {
    const tag = countryMatches[i][1];
    const blockStart = countryMatches[i].index + countryMatches[i][0].length;
    const blockEnd =
      i + 1 < countryMatches.length
        ? countryMatches[i + 1].index
        : countriesBlock.length;
    const countryBlock = countriesBlock.slice(blockStart, blockEnd);
    const occupationStatus = getDirectNamedBlock(
      countryBlock,
      'occupation_status',
    );
    const occupation = occupationStatus
      ? getDirectNamedBlock(occupationStatus, 'occupation')
      : null;
    if (!occupation) continue;

    const laws = new Map<number, string>();
    const lawListRe = /\boccupation_law_list\s*=\s*\{/g;
    let lawListMatch: RegExpExecArray | null;
    while ((lawListMatch = lawListRe.exec(occupation)) !== null) {
      const [lawList, lawListEnd] = extractBlock(
        occupation,
        lawListMatch.index + lawListMatch[0].length,
      );
      lawListRe.lastIndex = lawListEnd;
      for (const match of lawList.matchAll(
        /\b(\d+)\s*=\s*"?([A-Za-z0-9_]+)"?/g,
      )) {
        laws.set(Number(match[1]), match[2]);
      }
    }

    if (laws.size > 0) result[tag] = laws;
  }

  return result;
}

function parseCountryIndustryByTag(
  countriesBlock: string,
): Record<string, CountryIndustry> {
  const result: Record<string, CountryIndustry> = {};
  const countryMatches = allMatches(COUNTRY_TAG_RE, countriesBlock);

  for (let i = 0; i < countryMatches.length; i++) {
    const tag = countryMatches[i][1];
    const blockStart = countryMatches[i].index + countryMatches[i][0].length;
    const blockEnd =
      i + 1 < countryMatches.length
        ? countryMatches[i + 1].index
        : countriesBlock.length;
    const countryBlock = countriesBlock.slice(blockStart, blockEnd);
    const buildings = getDirectNamedBlock(countryBlock, 'buildings');
    if (!buildings) continue;

    const civilian = parseIndustryBuilding(buildings, 'industrial_complex');
    const military = parseIndustryBuilding(buildings, 'arms_factory');
    result[tag] = {
      civilianFactories: civilian.healthy,
      militaryFactories: military.healthy,
    };
  }

  return result;
}

function parseRulingLeaderTraitsByTag(
  content: string,
  countriesBlock: string,
): Record<string, string[]> {
  const managerMatch = /\ncharacter_manager\s*=\s*\{/.exec(content);
  if (!managerMatch) return {};

  const [manager] = extractBlock(
    content,
    managerMatch.index + managerMatch[0].length,
  );
  const traitsByRef = new Map<string, string[]>();
  const characterRe = /\n\s*character\s*=\s*\{/g;
  let characterMatch: RegExpExecArray | null;

  while ((characterMatch = characterRe.exec(manager)) !== null) {
    const [character, characterEnd] = extractBlock(
      manager,
      characterMatch.index + characterMatch[0].length,
    );
    characterRe.lastIndex = characterEnd;
    const ref = /\bid\s*=\s*\{\s*id\s*=\s*(\d+)\s+type\s*=\s*(\d+)\s*\}/.exec(
      character,
    );
    if (!ref) continue;

    const traits = [...character.matchAll(/\btraits\s*=\s*\{([^}]*)\}/g)]
      .flatMap((match) => match[1].trim().split(/\s+/))
      .map((trait) => trait.replace(/^"|"$/g, ''))
      .filter(Boolean);
    traitsByRef.set(`${ref[2]}:${ref[1]}`, traits);
  }

  const result: Record<string, string[]> = {};
  const countryMatches = allMatches(COUNTRY_TAG_RE, countriesBlock);
  for (let i = 0; i < countryMatches.length; i++) {
    const tag = countryMatches[i][1];
    const blockStart = countryMatches[i].index + countryMatches[i][0].length;
    const blockEnd =
      i + 1 < countryMatches.length
        ? countryMatches[i + 1].index
        : countriesBlock.length;
    const countryBlock = countriesBlock.slice(blockStart, blockEnd);
    const politics = getDirectNamedBlock(countryBlock, 'politics');
    if (!politics) continue;

    const rulingParty = /\bruling_party\s*=\s*"?([A-Za-z0-9_]+)"?/.exec(
      politics,
    )?.[1];
    const parties = getDirectNamedBlock(politics, 'parties');
    const party =
      rulingParty && parties ? getDirectNamedBlock(parties, rulingParty) : null;
    const leaderRef = party
      ? /\bcharacter\s*=\s*\{\s*id\s*=\s*(\d+)\s+type\s*=\s*(\d+)\s*\}/.exec(
          party,
        )
      : null;
    if (!leaderRef) continue;

    result[tag] = traitsByRef.get(`${leaderRef[2]}:${leaderRef[1]}`) ?? [];
  }

  return result;
}

function activeIdeaIds(countryBlock: string): string[] {
  const politics = getDirectNamedBlock(countryBlock, 'politics');
  if (!politics) return [];

  return (/\bideas\s*=\s*\{([^}]*)\}/.exec(politics)?.[1] ?? '')
    .trim()
    .split(/\s+/)
    .map((idea) => idea.replace(/^"|"$/g, ''))
    .filter(Boolean);
}

type SubjectRelation = {
  overlord: string;
  subject: string;
  autonomy: string;
};

function parseSubjectRelations(countriesBlock: string): SubjectRelation[] {
  const result: SubjectRelation[] = [];
  const countryMatches = allMatches(COUNTRY_TAG_RE, countriesBlock);

  for (let i = 0; i < countryMatches.length; i++) {
    const blockStart = countryMatches[i].index + countryMatches[i][0].length;
    const blockEnd =
      i + 1 < countryMatches.length
        ? countryMatches[i + 1].index
        : countriesBlock.length;
    const countryBlock = countriesBlock.slice(blockStart, blockEnd);
    const puppetRe = /\bpuppet\s*=\s*\{([^}]*)\}/g;

    for (const match of countryBlock.matchAll(puppetRe)) {
      const body = match[1];
      const overlord = /\bfirst\s*=\s*"([A-Z][A-Z0-9]{2})"/.exec(body)?.[1];
      const subject = /\bsecond\s*=\s*"([A-Z][A-Z0-9]{2})"/.exec(body)?.[1];
      const autonomy = /\bautonomy_state\s*=\s*"([^"]+)"/.exec(body)?.[1];
      if (overlord && subject && autonomy) {
        result.push({ overlord, subject, autonomy });
      }
    }
  }

  return result;
}

function autonomyIndustryTransfer(autonomy: string): CountryIndustry {
  if (autonomy === 'autonomy_integrated_puppet') {
    return { civilianFactories: 0.25, militaryFactories: 0.75 };
  }
  if (autonomy === 'autonomy_reichsprotectorate') {
    return { civilianFactories: 0.25, militaryFactories: 0 };
  }
  return { civilianFactories: 0, militaryFactories: 0 };
}

function savedOverlordTransferFactor(
  countryBlock: string,
  factory: 'cic' | 'mic',
): number {
  return [
    ...countryBlock.matchAll(
      new RegExp(
        `\\b[a-z0-9_]*${factory}_to_overlord\\s*=\\s*(-?[0-9.]+)`,
        'gi',
      ),
    ),
  ].reduce((total, match) => total + Number(match[1]), 0);
}

function normalIndustryTransferModifier(
  countryBlock: string,
  leaderTraits: readonly string[],
): CountryIndustry {
  const ids = [...activeIdeaIds(countryBlock), ...leaderTraits];
  return ids.reduce<CountryIndustry>(
    (total, id) => {
      const modifier = NORMAL_INDUSTRY_TRANSFER_MODIFIERS[id];
      if (modifier) {
        total.civilianFactories += modifier.civilian;
        total.militaryFactories += modifier.military;
      }
      return total;
    },
    { civilianFactories: 0, militaryFactories: 0 },
  );
}

function calculateSubjectMilitaryFactories(
  countriesBlock: string,
  availableMilitaryByTag: Record<string, number>,
  countryIndustryByTag: Record<string, CountryIndustry>,
  rulingLeaderTraitsByTag: Record<string, string[]>,
): Record<string, number> {
  const rawByOverlord: Record<string, number> = {};
  const legacyByOverlord: Record<string, number> = {};
  const targetedRawByOverlord: Record<string, number> = {};
  const relations = parseSubjectRelations(countriesBlock);
  const legacyOverlords = new Set(
    relations
      .filter((relation) =>
        LEGACY_TARGETED_INDUSTRY_IDEA_RE.test(
          getDirectCountryBlock(countriesBlock, relation.subject) ?? '',
        ),
      )
      .map((relation) => relation.overlord),
  );

  for (const relation of relations) {
    const subjectBlock =
      getDirectCountryBlock(countriesBlock, relation.subject) ?? '';
    const stateBase = availableMilitaryByTag[relation.subject] ?? 0;
    const autonomy = autonomyIndustryTransfer(relation.autonomy);
    const saved = savedOverlordTransferFactor(subjectBlock, 'mic');

    if (legacyOverlords.has(relation.overlord)) {
      const factor = autonomy.militaryFactories + saved;
      const transferred = stateBase - Math.ceil(stateBase * (1 - factor));
      acc(legacyByOverlord, relation.overlord, transferred);
      if (LEGACY_TARGETED_INDUSTRY_IDEA_RE.test(subjectBlock)) {
        acc(targetedRawByOverlord, relation.overlord, stateBase * 0.15);
      }
      continue;
    }

    const base =
      stateBase +
      (countryIndustryByTag[relation.subject]?.militaryFactories ?? 0);
    const modifier = normalIndustryTransferModifier(
      subjectBlock,
      rulingLeaderTraitsByTag[relation.subject] ?? [],
    );
    acc(
      rawByOverlord,
      relation.overlord,
      base * (autonomy.militaryFactories + saved + modifier.militaryFactories),
    );
  }

  const result: Record<string, number> = { ...legacyByOverlord };
  for (const [overlord, raw] of Object.entries(rawByOverlord)) {
    result[overlord] = Math.round(raw);
  }
  for (const [overlord, raw] of Object.entries(targetedRawByOverlord)) {
    acc(result, overlord, Math.round(raw));
  }
  return result;
}

function combineTransferFactors(
  firstFactor: number,
  secondFactor: number,
): number {
  return 1 - (1 - firstFactor) * (1 - secondFactor);
}

function calculateTradeCivilianFactories(
  countriesBlock: string,
): Record<string, number> {
  const result: Record<string, number> = {};

  const countryMatches = allMatches(COUNTRY_TAG_RE, countriesBlock);

  for (let i = 0; i < countryMatches.length; i++) {
    const tag = countryMatches[i][1];

    const blockStart = countryMatches[i].index + countryMatches[i][0].length;

    const blockEnd =
      i + 1 < countryMatches.length
        ? countryMatches[i + 1].index
        : countriesBlock.length;

    const countryBlock = countriesBlock.slice(blockStart, blockEnd);

    const exportRe = /\bexport\s*=\s*\{/g;

    let exportMatch: RegExpExecArray | null;
    let tradeCiv = 0;

    while ((exportMatch = exportRe.exec(countryBlock)) !== null) {
      const exportBlock = extractBlock(
        countryBlock,
        exportMatch.index + exportMatch[0].length,
      )[0];

      exportRe.lastIndex =
        exportMatch.index + exportMatch[0].length + exportBlock.length + 1;

      const lendedCic = Number(
        /\blended_cic\s*=\s*(\d+)/.exec(exportBlock)?.[1] ?? 0,
      );

      tradeCiv += lendedCic;
    }

    if (tradeCiv > 0) {
      result[tag] = tradeCiv;
    }
  }

  return result;
}

function calculateGovernmentInExileFactories(
  countriesBlock: string,
): Record<string, number> {
  const result: Record<string, number> = {};
  const countryMatches = allMatches(COUNTRY_TAG_RE, countriesBlock);

  for (let i = 0; i < countryMatches.length; i++) {
    const blockStart = countryMatches[i].index + countryMatches[i][0].length;
    const blockEnd =
      i + 1 < countryMatches.length
        ? countryMatches[i + 1].index
        : countriesBlock.length;
    const countryBlock = countriesBlock.slice(blockStart, blockEnd);
    const host =
      /\bhosting_our_government_in_exile\s*=\s*"([A-Z][A-Z0-9]{2})"/.exec(
        countryBlock,
      )?.[1];
    if (!host) continue;

    const legitimacy = Number(
      /\blegitimacy\s*=\s*([0-9.]+)/.exec(countryBlock)?.[1] ?? 0,
    );
    const donatedFactories = Math.max(
      0,
      Math.min(
        GOVERNMENT_IN_EXILE_FACTORY_DONATION_MAX,
        Math.round(
          (legitimacy / 100) * GOVERNMENT_IN_EXILE_FACTORY_DONATION_MAX,
        ),
      ),
    );
    if (donatedFactories > 0) acc(result, host, donatedFactories);
  }

  return result;
}

function calculateSubjectCivilianFactories(
  countriesBlock: string,
  availableCivilianByTag: Record<string, number>,
  countryIndustryByTag: Record<string, CountryIndustry>,
  tradeCivilianByTag: Record<string, number>,
  rulingLeaderTraitsByTag: Record<string, string[]>,
): Record<string, number> {
  const rawByOverlord: Record<string, number> = {};
  const legacyByOverlord: Record<string, number> = {};
  const relations = parseSubjectRelations(countriesBlock);
  const legacyOverlords = new Set(
    relations
      .filter((relation) =>
        LEGACY_TARGETED_INDUSTRY_IDEA_RE.test(
          getDirectCountryBlock(countriesBlock, relation.subject) ?? '',
        ),
      )
      .map((relation) => relation.overlord),
  );

  for (const relation of relations) {
    const subjectBlock =
      getDirectCountryBlock(countriesBlock, relation.subject) ?? '';
    const stateBase = availableCivilianByTag[relation.subject] ?? 0;

    const autonomy = autonomyIndustryTransfer(relation.autonomy);
    const saved = savedOverlordTransferFactor(subjectBlock, 'cic');

    if (legacyOverlords.has(relation.overlord)) {
      const targeted = LEGACY_TARGETED_INDUSTRY_IDEA_RE.test(subjectBlock)
        ? 0.2
        : 0;
      const factor = combineTransferFactors(
        autonomy.civilianFactories,
        targeted + saved,
      );
      const transferred =
        stateBase - Math.ceil(stateBase * (1 - factor) - 1e-9);
      acc(legacyByOverlord, relation.overlord, transferred);
      continue;
    }

    const base =
      stateBase +
      (countryIndustryByTag[relation.subject]?.civilianFactories ?? 0) +
      (tradeCivilianByTag[relation.subject] ?? 0);
    if (base <= 0) continue;
    const modifier = normalIndustryTransferModifier(
      subjectBlock,
      rulingLeaderTraitsByTag[relation.subject] ?? [],
    );
    acc(
      rawByOverlord,
      relation.overlord,
      base * (autonomy.civilianFactories + saved + modifier.civilianFactories),
    );
  }

  const result: Record<string, number> = { ...legacyByOverlord };
  for (const [overlord, raw] of Object.entries(rawByOverlord)) {
    result[overlord] = Math.round(raw);
  }
  return result;
}

function calculateAvailableMilitaryByController(
  industryStates: IndustryState[],
  occupiedMilitaryByController: Record<string, number>,
): Record<string, number> {
  const nonOccupiedControlledMilitaryByTag: Record<string, number> = {};

  for (const state of industryStates) {
    if (state.occupiedTag || state.militaryFactories <= 0) continue;

    acc(
      nonOccupiedControlledMilitaryByTag,
      state.controller,
      state.militaryFactories,
    );
  }

  const result: Record<string, number> = {};
  const tags = new Set([
    ...Object.keys(nonOccupiedControlledMilitaryByTag),
    ...Object.keys(occupiedMilitaryByController),
  ]);

  for (const tag of tags) {
    result[tag] =
      (nonOccupiedControlledMilitaryByTag[tag] ?? 0) +
      (occupiedMilitaryByController[tag] ?? 0);
  }

  return result;
}

function parseCoresByTag(countriesBlock: string): Record<string, Set<number>> {
  const result: Record<string, Set<number>> = {};

  const countryMatches = allMatches(COUNTRY_TAG_RE, countriesBlock);

  for (let i = 0; i < countryMatches.length; i++) {
    const tag = countryMatches[i][1];

    const blockStart = countryMatches[i].index + countryMatches[i][0].length;

    const blockEnd =
      i + 1 < countryMatches.length
        ? countryMatches[i + 1].index
        : countriesBlock.length;

    const countryBlock = countriesBlock.slice(blockStart, blockEnd);

    const coresMatch = /\bcores\s*=\s*\{([^}]*)\}/.exec(countryBlock);

    result[tag] = new Set(
      coresMatch
        ? coresMatch[1].trim().split(/\s+/).map(Number).filter(Number.isFinite)
        : [],
    );
  }

  return result;
}
function calculateOwnedCivilianFactoriesByController(
  industryStates: IndustryState[],
  countriesBlock: string,
): Record<string, number> {
  const coresByTag = parseCoresByTag(countriesBlock);
  const occupationLaws = parseOccupationLawsByController(countriesBlock);

  const result: Record<string, number> = {};

  for (const state of industryStates) {
    if (state.healthyCivilianFactories <= 0) {
      continue;
    }

    const controllerCores = coresByTag[state.controller];

    const isControllerCore = controllerCores?.has(state.id) ?? false;

    const isAutonomousOwnOccupation =
      state.owner === state.controller &&
      state.occupiedTag !== null &&
      occupationLaws[state.controller]?.get(state.id) ===
        'autonomous_occupation';

    if (!isControllerCore && !isAutonomousOwnOccupation) {
      continue;
    }

    const countsAsOwned =
      state.owner === state.controller || state.occupiedTag === null;

    if (!countsAsOwned) {
      continue;
    }

    acc(result, state.controller, state.healthyCivilianFactories);
  }

  return result;
}

function calculateAvailableCivilianByController(
  industryStates: IndustryState[],
): Record<string, number> {
  const cleanByController: Record<string, number> = {};
  const occupiedRawByController: Record<string, number> = {};

  for (const state of industryStates) {
    if (state.civilianFactories <= 0) {
      continue;
    }

    if (!state.occupiedTag) {
      acc(cleanByController, state.controller, state.civilianFactories);

      continue;
    }

    const compliance = state.compliancePercent ?? 0;

    const factor =
      0.25 + 0.65 * (compliance / 100) + (compliance >= 40 ? 0.1 : 0);

    acc(
      occupiedRawByController,
      state.controller,
      state.civilianFactories * factor,
    );
  }

  const result: Record<string, number> = {};

  const tags = new Set([
    ...Object.keys(cleanByController),
    ...Object.keys(occupiedRawByController),
  ]);

  for (const tag of tags) {
    result[tag] =
      (cleanByController[tag] ?? 0) +
      Math.round(occupiedRawByController[tag] ?? 0);
  }

  return result;
}

function calculateEffectiveOwnMilitaryFactoriesByController(
  industryStates: IndustryState[],
  countriesBlock: string,
): Record<string, number> {
  const result: Record<string, number> = {};
  const coresByTag: Record<string, Set<number>> = {};
  const occupationLaws = parseOccupationLawsByController(countriesBlock);

  // COUNTRY_TAG_RE matches direct country entries in countries={} (`\n\tTAG={`).
  // Parse each country block once using neighbouring offsets instead of
  // rescanning the entire countriesBlock for every tag.
  const countryMatches = allMatches(COUNTRY_TAG_RE, countriesBlock);

  for (let i = 0; i < countryMatches.length; i++) {
    const tag = countryMatches[i][1];
    const blockStart = countryMatches[i].index + countryMatches[i][0].length;
    const blockEnd =
      i + 1 < countryMatches.length
        ? countryMatches[i + 1].index
        : countriesBlock.length;

    const countryBlock = countriesBlock.slice(blockStart, blockEnd);

    const coresMatch = /\bcores\s*=\s*\{([^}]*)\}/.exec(countryBlock);

    coresByTag[tag] = new Set(
      coresMatch
        ? coresMatch[1].trim().split(/\s+/).map(Number).filter(Number.isFinite)
        : [],
    );
  }

  const fullCoreMilitaryByTag: Record<string, number> = {};
  const foreignOwnedOccupiedCoreGroups: Record<
    string,
    Record<
      string,
      {
        physicalMilitaryFactories: number;
        complianceWeightedMilitaryFactories: number;
      }
    >
  > = {};

  // Single pass over the already parsed state index.
  for (const state of industryStates) {
    if (state.healthyMilitaryFactories <= 0) continue;

    const cores = coresByTag[state.controller];
    const isControllerCore = cores?.has(state.id) ?? false;
    const isAutonomousOwnOccupation =
      state.owner === state.controller &&
      state.occupiedTag !== null &&
      occupationLaws[state.controller]?.get(state.id) ===
        'autonomous_occupation';
    if (!isControllerCore && !isAutonomousOwnOccupation) continue;

    // A core of the controller that is still foreign-owned and has active
    // occupation mechanics contributes occupation-effective MIC instead of
    // its full physical MIC to the own/core bucket.
    if (
      isControllerCore &&
      state.owner !== state.controller &&
      state.occupiedTag
    ) {
      const compliance = state.compliancePercent / 100;
      const localFactoryFactor =
        0.25 + 0.65 * compliance + (state.compliancePercent >= 40 ? 0.1 : 0);

      foreignOwnedOccupiedCoreGroups[state.controller] ??= {};

      const group = foreignOwnedOccupiedCoreGroups[state.controller][
        state.occupiedTag
      ] ?? {
        physicalMilitaryFactories: 0,
        complianceWeightedMilitaryFactories: 0,
      };

      group.physicalMilitaryFactories += state.healthyMilitaryFactories;
      group.complianceWeightedMilitaryFactories +=
        state.healthyMilitaryFactories * localFactoryFactor;

      foreignOwnedOccupiedCoreGroups[state.controller][state.occupiedTag] =
        group;

      continue;
    }

    acc(
      fullCoreMilitaryByTag,
      state.controller,
      state.healthyMilitaryFactories,
    );
  }

  const tags = new Set([
    ...Object.keys(fullCoreMilitaryByTag),
    ...Object.keys(foreignOwnedOccupiedCoreGroups),
  ]);

  for (const tag of tags) {
    let adjustedForeignOwnedCoreMilitary = 0;

    for (const group of Object.values(
      foreignOwnedOccupiedCoreGroups[tag] ?? {},
    )) {
      if (group.physicalMilitaryFactories <= 0) continue;

      adjustedForeignOwnedCoreMilitary += Math.max(
        1,
        Math.round(group.complianceWeightedMilitaryFactories),
      );
    }

    result[tag] =
      (fullCoreMilitaryByTag[tag] ?? 0) + adjustedForeignOwnedCoreMilitary;
  }

  return result;
}

function calculateRuntimeDockyards(countryBlock: string): {
  shipProduction: number;
  repair: number;
  effective: number;
} {
  let navalProduction = 0;
  let refitProduction = 0;

  const navalLineRe = /\bnaval_lines\s*=\s*\{/g;
  let navalMatch: RegExpExecArray | null;

  while ((navalMatch = navalLineRe.exec(countryBlock)) !== null) {
    const [lineBlock, lineEnd] = extractBlock(
      countryBlock,
      navalMatch.index + navalMatch[0].length,
    );

    navalProduction += Number(
      /\bactive_factories\s*=\s*(\d+)/.exec(lineBlock)?.[1] ?? 0,
    );

    navalLineRe.lastIndex = lineEnd;
  }

  const refitLineRe = /\bship_refit_lines\s*=\s*\{/g;
  let refitMatch: RegExpExecArray | null;

  while ((refitMatch = refitLineRe.exec(countryBlock)) !== null) {
    const [lineBlock, lineEnd] = extractBlock(
      countryBlock,
      refitMatch.index + refitMatch[0].length,
    );

    refitProduction += Number(
      /\bactive_factories\s*=\s*(\d+)/.exec(lineBlock)?.[1] ?? 0,
    );

    refitLineRe.lastIndex = lineEnd;
  }

  const repair = Number(
    /\bnum_used_dockyards\s*=\s*(\d+)/.exec(countryBlock)?.[1] ?? 0,
  );

  const shipProduction = navalProduction + refitProduction;

  return {
    shipProduction,
    repair,
    effective: shipProduction + repair,
  };
}

function calculateEffectiveDockyards(
  countriesBlock: string,
): Record<string, number> {
  const result: Record<string, number> = {};

  const countryMatches = allMatches(COUNTRY_TAG_RE, countriesBlock);

  for (let i = 0; i < countryMatches.length; i++) {
    const tag = countryMatches[i][1];

    const blockStart = countryMatches[i].index + countryMatches[i][0].length;

    const blockEnd =
      i + 1 < countryMatches.length
        ? countryMatches[i + 1].index
        : countriesBlock.length;

    const countryBlock = countriesBlock.slice(blockStart, blockEnd);

    let productionDockyards = 0;

    const navalLineRe = /\bnaval_lines\s*=\s*\{/g;
    let navalMatch: RegExpExecArray | null;

    while ((navalMatch = navalLineRe.exec(countryBlock)) !== null) {
      const block = extractBlock(
        countryBlock,
        navalMatch.index + navalMatch[0].length,
      )[0];

      navalLineRe.lastIndex =
        navalMatch.index + navalMatch[0].length + block.length + 1;

      productionDockyards += Number(
        /\bactive_factories\s*=\s*(\d+)/.exec(block)?.[1] ?? 0,
      );
    }

    const refitLineRe = /\bship_refit_lines\s*=\s*\{/g;

    let refitMatch: RegExpExecArray | null;

    while ((refitMatch = refitLineRe.exec(countryBlock)) !== null) {
      const block = extractBlock(
        countryBlock,
        refitMatch.index + refitMatch[0].length,
      )[0];

      refitLineRe.lastIndex =
        refitMatch.index + refitMatch[0].length + block.length + 1;

      productionDockyards += Number(
        /\bactive_factories\s*=\s*(\d+)/.exec(block)?.[1] ?? 0,
      );
    }

    const repairDockyards = Number(
      /\bnum_used_dockyards\s*=\s*(\d+)/.exec(countryBlock)?.[1] ?? 0,
    );

    const effective = productionDockyards + repairDockyards;

    if (effective > 0) {
      result[tag] = effective;
    }
  }

  return result;
}

// ── Main analyzer ─────────────────────────────────────────────────────────────

export function analyzeSave(filePath: string): AnalyzeResult {
  const t0 = performance.now();
  const content = readSave(filePath);

  const sizeMb =
    Math.round((fs.statSync(filePath).size / 1_048_576) * 100) / 100;

  const topLevelBlocks = findDirectBlocks(content, 0, content.length);

  const equipmentRegistry = parseEquipmentRegistry(content, topLevelBlocks);
  const stockpileRecords = parseNationalStockpile(
    content,
    equipmentRegistry,
    topLevelBlocks,
  );
  const stockpileSummaries = aggregateNationalStockpile(stockpileRecords);

  const militaryProductionRecords = parseMilitaryProductionLines(
    content,
    equipmentRegistry,
    topLevelBlocks,
  );

  const militaryProductionSummaries = aggregateMilitaryProduction(
    militaryProductionRecords,
  );

  const divisions = parseDivisions(content, equipmentRegistry, topLevelBlocks);

  const divisionTemplates = parseDivisionTemplates(content, topLevelBlocks);
  const resolvedDivisions = aggregateDivisions(divisions, divisionTemplates);
  const armyHierarchy = parseArmyHierarchy(content, topLevelBlocks);
  const linkedArmyHierarchy = linkArmyHierarchy(
    armyHierarchy,
    resolvedDivisions,
  );
  const {
    divisionSummaries,
    divisionTemplateCatalog,
    divisionEquipmentCatalog,
  } = toPublicDivisionData(resolvedDivisions);
  const armyHierarchySummaries =
    toPublicArmyHierarchySummaries(linkedArmyHierarchy);

  const globalNavalLosses = parseGlobalNavalLossHistory(content);
  const shipHistoryNavalLosses = parseShipHistoryNavalLosses(content);
  const navalLosses = deduplicateNavalLosses(
    [...globalNavalLosses, ...shipHistoryNavalLosses.records],
    shipHistoryNavalLosses.parentContexts,
  );
  const navalLossSummaries = aggregateNavalLosses(navalLosses);
  const navalKillResolutions = resolveCreditedNavalKills(
    navalLosses,
    shipHistoryNavalLosses.parentContexts,
  );
  const navalKills = navalKillResolutions.flatMap(({ creditedKill }) =>
    creditedKill ? [creditedKill] : [],
  );
  const {
    countrySummaries: navalKillSummaries,
    killerShipSummaries: navalKillerShipSummaries,
  } = aggregateCreditedNavalKills(navalKills);

  // ── Game date ──
  const gameDate = DATE_RE.exec(content.slice(0, 20_000))?.[1] ?? 'unknown';

  // ── Per-tag accumulators (each filled by exactly one source) ──
  const divByOwner: Record<string, number> = {}; // countries → units → division
  const mpByTag: Record<string, number> = {}; // division → army_manpower_value
  const aircraftByTag: Record<string, number> = {}; // air_wing_pool → air_wings → count
  const shipsByTag: Record<string, number> = {}; // fleet → task_force → ship
  const milFacByTag: Record<string, number> = {}; // states → state → buildings.arms_factory
  const civFacByTag: Record<string, number> = {}; // states → state → buildings.industrial_complex
  const docksByTag: Record<string, number> = {}; // states → state → buildings.dockyard
  const shipProductionDockyardsByTag: Record<string, number> = {};
  const repairDockyardsByTag: Record<string, number> = {};
  // Parse war_relation blocks into a raw array of ParsedWarCasualties
  const parsedWarCasualties: ParsedWarCasualties[] = [];
  const WAR_REL_RE = /\bwar_relation\s*=\s*\{/g;
  for (const wm of allMatches(WAR_REL_RE, content)) {
    const [wb] = extractBlock(content, wm.index + wm[0].length);
    const fM = /first\s*=\s*"([A-Z][A-Z0-9]{2})"/.exec(wb);
    const sM = /second\s*=\s*"([A-Z][A-Z0-9]{2})"/.exec(wb);
    const fcM = /first_casualties\s*=\s*([0-9.]+)/.exec(wb);
    const scM = /second_casualties\s*=\s*([0-9.]+)/.exec(wb);
    const sdM = /start_date\s*=\s*"([^"]+)"/.exec(wb);
    // collect wargoal ids found inside this war_relation (if any)
    const wargoalIds: number[] = [];
    for (const wmGoal of allMatches(
      /wargoal\s*=\s*\{\s*id\s*=\s*([0-9]+)/g,
      wb,
    )) {
      wargoalIds.push(parseInt(wmGoal[1]));
    }
    let parentTag: string | null = null;
    const tagPattern = /([A-Z][A-Z0-9]{2})/g;
    let match: RegExpExecArray | null;
    let bestTag: string | null = null;
    let bestPos = -1;
    while ((match = tagPattern.exec(wb)) !== null) {
      const tag = match[1];
      const pos = match.index;
      if (pos > bestPos) {
        bestTag = tag;
        bestPos = pos;
      }
    }
    if (
      bestTag &&
      bestTag !== (fM?.[1] ?? null) &&
      bestTag !== (sM?.[1] ?? null)
    ) {
      parentTag = bestTag;
    }

    parsedWarCasualties.push({
      firstTag: fM ? fM[1] : null,
      secondTag: sM ? sM[1] : null,
      startDate: sdM ? sdM[1] : null,
      firstCasualties: fcM ? parseInt(fcM[1]) : null,
      secondCasualties: scM ? parseInt(scM[1]) : null,
      parentTag,
      sourceOffset: wm.index,
      wargoalIds,
    });
  }

  // ── Equipment id → name lookup ──
  const eqLookup: Record<number, string> = {};
  for (const equipment of equipmentRegistry.records) {
    if (equipment.equipmentRef.type !== 70) continue;
    const id = equipment.equipmentRef.id;
    if (!(id in eqLookup)) eqLookup[id] = equipment.definition;
  }

  // ── States block: active countries + industry ──
  let activeCountries = 0;
  let occupiedMilFacByController: Record<string, number> = {};
  let occupiedCivByController: Record<string, number> = {};
  let ownedCivByController: Record<string, number> = {};
  let tradeCivByTag: Record<string, number> = {};
  let governmentInExileFactoriesByTag: Record<string, number> = {};
  let countryIndustryByTag: Record<string, CountryIndustry> = {};
  let rulingLeaderTraitsByTag: Record<string, string[]> = {};
  let effectiveDockyardsByTag: Record<string, number> = {};
  let availableMilitaryByTag: Record<string, number> = {};
  let industryStates: IndustryState[] = [];
  const statesMatch = /\nstates\s*=\s*\{/.exec(content);
  if (statesMatch) {
    const [statesBlock] = extractBlock(
      content,
      statesMatch.index + statesMatch[0].length,
    );

    industryStates = parseIndustryStates(statesBlock);

    // Count unique owners
    const ownerSet = new Set<string>();
    for (const m of allMatches(OWNER_RE, statesBlock)) ownerSet.add(m[1]);
    activeCountries = ownerSet.size;

    // Physical industry by owner from the already parsed state index.
    for (const state of industryStates) {
      if (state.militaryFactories > 0) {
        acc(milFacByTag, state.owner, state.militaryFactories);
      }
      if (state.civilianFactories > 0) {
        acc(civFacByTag, state.owner, state.civilianFactories);
      }
      if (state.dockyards > 0) {
        acc(docksByTag, state.owner, state.dockyards);
      }
    }
  }

  // ── Countries block: divisions + manpowerInField + equipment ──
  const eqByCountry: Record<string, Record<string, number>> = {};
  let countriesBlock = '';

  const countriesMatch = /\ncountries\s*=\s*\{/.exec(content);
  if (countriesMatch) {
    const [cb] = extractBlock(
      content,
      countriesMatch.index + countriesMatch[0].length,
    );

    countriesBlock = cb;
    const cms = allMatches(COUNTRY_TAG_RE, cb);

    for (let i = 0; i < cms.length; i++) {
      const owner = cms[i][1];
      const bs = cms[i].index + cms[i][0].length;
      const be = i + 1 < cms.length ? cms[i + 1].index : cb.length;
      const countryBlock = cb.slice(bs, be);
      const runtimeDockyards = calculateRuntimeDockyards(countryBlock);

      shipProductionDockyardsByTag[owner] = runtimeDockyards.shipProduction;

      repairDockyardsByTag[owner] = runtimeDockyards.repair;

      effectiveDockyardsByTag[owner] = runtimeDockyards.effective;

      for (const um of allMatches(UNITS_RE, countryBlock)) {
        const [ub] = extractBlock(countryBlock, um.index + um[0].length);
        for (const dm of allMatches(DIVISION_RE, ub)) {
          const [db] = extractBlock(ub, dm.index + dm[0].length);
          acc(divByOwner, owner, 1);

          // manpowerInField — from army_manpower_value, attributed to the tag inside
          const amM = ARMY_MP_RE.exec(db);
          if (amM) {
            const [ampB] = extractBlock(db, amM.index + amM[0].length);
            const mvM = MP_VAL_RE.exec(ampB);
            if (mvM) {
              const [valB] = extractBlock(ampB, mvM.index + mvM[0].length);
              for (const e of allMatches(MP_ENTRY_RE, valB))
                acc(mpByTag, e[1], parseInt(e[2]));
            }
          }

          // Equipment
          const ceq = (eqByCountry[owner] ??= {});
          for (const ee of allMatches(EQ_ENTRY_RE, db)) {
            const name = eqLookup[parseInt(ee[1])] ?? `eq_${ee[1]}`;
            ceq[name] = (ceq[name] ?? 0) + parseFloat(ee[2]);
          }
        }
      }
    }
  }

  if (countriesBlock) {
    const occupiedIndustry = calculateOccupiedIndustryByController(
      industryStates,
      countriesBlock,
    );
    occupiedMilFacByController = occupiedIndustry.military;
    occupiedCivByController = occupiedIndustry.civilian;
    availableMilitaryByTag = calculateAvailableMilitaryByController(
      industryStates,
      occupiedIndustry.transferableMilitary,
    );

    ownedCivByController = calculateOwnedCivilianFactoriesByController(
      industryStates,
      countriesBlock,
    );
    tradeCivByTag = calculateTradeCivilianFactories(countriesBlock);
    governmentInExileFactoriesByTag =
      calculateGovernmentInExileFactories(countriesBlock);
    countryIndustryByTag = parseCountryIndustryByTag(countriesBlock);
    rulingLeaderTraitsByTag = parseRulingLeaderTraitsByTag(
      content,
      countriesBlock,
    );
    effectiveDockyardsByTag = calculateEffectiveDockyards(countriesBlock);
  }

  const availableCivilianByTag =
    calculateAvailableCivilianByController(industryStates);

  const subjectCivByTag = countriesBlock
    ? calculateSubjectCivilianFactories(
        countriesBlock,
        availableCivilianByTag,
        countryIndustryByTag,
        tradeCivByTag,
        rulingLeaderTraitsByTag,
      )
    : {};

  const subjectMilByTag = countriesBlock
    ? calculateSubjectMilitaryFactories(
        countriesBlock,
        availableMilitaryByTag,
        countryIndustryByTag,
        rulingLeaderTraitsByTag,
      )
    : {};

  const effectiveOwnMilByTag =
    countriesBlock && industryStates.length > 0
      ? calculateEffectiveOwnMilitaryFactoriesByController(
          industryStates,
          countriesBlock,
        )
      : {};

  // ── Ships: fleet → task_force → logical_country ──
  for (const fm of allMatches(FLEET_RE, content)) {
    const [fb] = extractBlock(content, fm.index + fm[0].length);
    for (const tm of allMatches(TASK_FORCE_RE, fb)) {
      const [tb] = extractBlock(fb, tm.index + tm[0].length);
      const cnt = allMatches(SHIP_RE, tb).length;
      if (!cnt) continue;
      acc(shipsByTag, LOGICAL_TAG_RE.exec(tb)?.[1] ?? '???', cnt);
    }
  }

  // ── Aircraft: air_wing_pool → air_wings → tag= ──
  for (const pm of allMatches(AIR_POOL_RE, content)) {
    const [pb] = extractBlock(content, pm.index + pm[0].length);
    for (const aw of allMatches(AIR_WINGS_RE, pb)) {
      const [ab] = extractBlock(pb, aw.index + aw[0].length);
      const mc = COUNT_RE.exec(ab);
      if (!mc) continue;
      acc(aircraftByTag, TAG_IN_RE.exec(ab)?.[1] ?? '???', parseInt(mc[1]));
    }
  }

  // ── Finalize equipment ──
  for (const tag of Object.keys(eqByCountry)) {
    const sorted: Record<string, number> = {};
    for (const [k, v] of Object.entries(eqByCountry[tag]).sort(
      ([, a], [, b]) => b - a,
    ))
      sorted[k] = Math.round(v * 10) / 10;
    eqByCountry[tag] = sorted;
  }
  const worldEq: Record<string, number> = {};
  for (const eq of Object.values(eqByCountry))
    for (const [k, v] of Object.entries(eq)) worldEq[k] = (worldEq[k] ?? 0) + v;
  const worldEqSorted: Record<string, number> = {};
  for (const [k, v] of Object.entries(worldEq).sort(([, a], [, b]) => b - a))
    worldEqSorted[k] = Math.round(v * 10) / 10;

  // ── Build CountryStats[] ──
  const allTags = new Set<string>();
  for (const tag of Object.keys(divByOwner)) allTags.add(tag);
  for (const tag of Object.keys(mpByTag)) allTags.add(tag);
  for (const tag of Object.keys(aircraftByTag)) allTags.add(tag);
  for (const tag of Object.keys(shipsByTag)) allTags.add(tag);
  for (const tag of Object.keys(milFacByTag)) allTags.add(tag);
  for (const tag of Object.keys(civFacByTag)) allTags.add(tag);

  for (const tag of Object.keys(effectiveDockyardsByTag)) {
    allTags.add(tag);
  }
  for (const tag of Object.keys(occupiedMilFacByController)) {
    allTags.add(tag);
  }
  for (const tag of Object.keys(subjectCivByTag)) {
    allTags.add(tag);
  }
  for (const tag of Object.keys(occupiedCivByController)) {
    allTags.add(tag);
  }
  for (const tag of Object.keys(ownedCivByController)) {
    allTags.add(tag);
  }
  for (const tag of Object.keys(tradeCivByTag)) {
    allTags.add(tag);
  }
  for (const tag of Object.keys(effectiveDockyardsByTag)) {
    allTags.add(tag);
  }
  for (const tag of Object.keys(subjectMilByTag)) {
    allTags.add(tag);
  }
  for (const tag of Object.keys(effectiveOwnMilByTag)) {
    allTags.add(tag);
  }
  for (const tag of Object.keys(governmentInExileFactoriesByTag)) {
    allTags.add(tag);
  }
  for (const war of parsedWarCasualties) {
    if (war.firstTag) allTags.add(war.firstTag);
    if (war.secondTag) allTags.add(war.secondTag);
  }

  const byCountry: CountryStats[] = [];
  for (const tag of allTags) {
    const warCasualtiesForTag: CountryWarCasualties[] = [];
    for (const entry of parsedWarCasualties) {
      if (entry.firstTag === tag) {
        warCasualtiesForTag.push({
          opponentTag: entry.secondTag ?? '',
          startDate: entry.startDate,
          role: 'first',
          casualties: entry.firstCasualties ?? 0,
        });
      }
      if (entry.secondTag === tag) {
        warCasualtiesForTag.push({
          opponentTag: entry.firstTag ?? '',
          startDate: entry.startDate,
          role: 'second',
          casualties: entry.secondCasualties ?? 0,
        });
      }
    }

    const s: CountryStats = {
      tag,
      divisions: divByOwner[tag] ?? 0,
      manpowerInField: mpByTag[tag] ?? 0,
      // Do NOT set manpowerCasualties from ambiguous candidates here. It
      // would be unsafe: multiple parsedWarCasualties entries may exist for
      // a tag and order in the save is not semantically meaningful. Use
      // `null` to indicate "not yet calculated" until a deliberate
      // deduplication/aggregation pass is added.
      manpowerCasualties: null,
      warCasualties: warCasualtiesForTag,
      calculatedWarCasualtiesTotal: warCasualtiesForTag.reduce(
        (sum, entry) => sum + entry.casualties,
        0,
      ),
      aircraft: aircraftByTag[tag] ?? 0,
      ships: shipsByTag[tag] ?? 0,
      militaryFactories: milFacByTag[tag] ?? 0,
      civilianFactories: civFacByTag[tag] ?? 0,
      dockyards: docksByTag[tag] ?? 0,
      effectiveDockyards: effectiveDockyardsByTag[tag] ?? docksByTag[tag] ?? 0,
      shipProductionDockyards: shipProductionDockyardsByTag[tag] ?? 0,
      repairDockyards: repairDockyardsByTag[tag] ?? 0,
      occupiedMilitaryFactories: occupiedMilFacByController[tag] ?? 0,
      subjectMilitaryFactories: subjectMilByTag[tag] ?? 0,
      subjectCivilianFactories: subjectCivByTag[tag] ?? 0,
      occupiedCivilianFactories: occupiedCivByController[tag] ?? 0,
      ownedCivilianFactories: ownedCivByController[tag] ?? 0,
      tradeCivilianFactories: tradeCivByTag[tag] ?? 0,
      effectiveCivilianFactories:
        (ownedCivByController[tag] ?? 0) +
        (occupiedCivByController[tag] ?? 0) +
        (subjectCivByTag[tag] ?? 0) +
        (tradeCivByTag[tag] ?? 0) +
        (governmentInExileFactoriesByTag[tag] ?? 0),
      effectiveOwnMilitaryFactories: effectiveOwnMilByTag[tag] ?? 0,
      effectiveMilitaryFactories:
        (effectiveOwnMilByTag[tag] ?? 0) +
        (occupiedMilFacByController[tag] ?? 0) +
        (subjectMilByTag[tag] ?? 0) +
        (governmentInExileFactoriesByTag[tag] ?? 0),
    };
    // Include countries with any metric or with war casualty entries.
    const hasAnyMetric = Object.values(s).some(
      (value) => typeof value === 'number' && value > 0,
    );
    if (hasAnyMetric || warCasualtiesForTag.length > 0) byCountry.push(s);
  }
  byCountry.sort((a, b) => b.manpowerInField - a.manpowerInField);

  // ── Compute totals (same shape as CountryStats minus tag) ──
  const totals: CountryTotals = {
    divisions: byCountry.reduce((n, r) => n + r.divisions, 0),
    manpowerInField: byCountry.reduce((n, r) => n + r.manpowerInField, 0),
    // Do not aggregate manpowerCasualties here; raw entries are returned in
    // `warCasualties` for downstream deduplication and aggregation.
    manpowerCasualties: null,
    warCasualties: [],
    occupiedCivilianFactories: byCountry.reduce(
      (sum, country) => sum + country.occupiedCivilianFactories,
      0,
    ),
    ownedCivilianFactories: byCountry.reduce(
      (sum, country) => sum + country.ownedCivilianFactories,
      0,
    ),
    tradeCivilianFactories: byCountry.reduce(
      (sum, country) => sum + country.tradeCivilianFactories,
      0,
    ),

    effectiveCivilianFactories: byCountry.reduce(
      (sum, country) => sum + country.effectiveCivilianFactories,
      0,
    ),
    aircraft: byCountry.reduce((n, r) => n + r.aircraft, 0),
    ships: byCountry.reduce((n, r) => n + r.ships, 0),
    militaryFactories: byCountry.reduce((n, r) => n + r.militaryFactories, 0),
    civilianFactories: byCountry.reduce((n, r) => n + r.civilianFactories, 0),
    dockyards: byCountry.reduce((n, r) => n + r.dockyards, 0),
    effectiveDockyards: byCountry.reduce(
      (sum, country) => sum + country.effectiveDockyards,
      0,
    ),
    shipProductionDockyards: byCountry.reduce(
      (n, r) => n + r.shipProductionDockyards,
      0,
    ),

    repairDockyards: byCountry.reduce((n, r) => n + r.repairDockyards, 0),

    occupiedMilitaryFactories: byCountry.reduce(
      (n, r) => n + r.occupiedMilitaryFactories,
      0,
    ),
    subjectMilitaryFactories: byCountry.reduce(
      (n, r) => n + r.subjectMilitaryFactories,
      0,
    ),
    subjectCivilianFactories: byCountry.reduce(
      (n, r) => n + r.subjectCivilianFactories,
      0,
    ),

    effectiveOwnMilitaryFactories: byCountry.reduce(
      (n, r) => n + r.effectiveOwnMilitaryFactories,
      0,
    ),
    effectiveMilitaryFactories: byCountry.reduce(
      (n, r) => n + r.effectiveMilitaryFactories,
      0,
    ),
  };

  return {
    game_date: gameDate,
    file_size_mb: sizeMb,
    parse_seconds: Math.round((performance.now() - t0) / 10) / 100,
    active_countries: activeCountries,
    totals,
    by_country: byCountry,
    equipment_by_country: eqByCountry,
    world_equipment: worldEqSorted,
    stockpileSummaries,
    militaryProductionSummaries,
    divisionSummaries,
    divisionTemplateCatalog,
    divisionEquipmentCatalog,
    armyHierarchySummaries,
    warCasualties: parsedWarCasualties,
    navalLosses,
    navalLossSummaries,
    navalKills,
    navalKillSummaries,
    navalKillerShipSummaries,
  };
}
