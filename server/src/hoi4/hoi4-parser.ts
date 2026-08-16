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
const MIL_FAC_RE = /\barms_factory\s*=\s*\{[^}]*level\s*=\s*(\d+)/;
const CIV_FAC_RE = /\bindustrial_complex\s*=\s*\{[^}]*level\s*=\s*(\d+)/;
const DOCKYARD_RE = /\bdockyard\s*=\s*\{[^}]*level\s*=\s*(\d+)/;

// ── Per-tag accumulator helpers ───────────────────────────────────────────────

function acc(map: Record<string, number>, key: string, delta: number) {
  map[key] = (map[key] ?? 0) + delta;
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
  const statesMatch = /\nstates\s*=\s*\{/.exec(content);
  if (statesMatch) {
    const [statesBlock] = extractBlock(
      content,
      statesMatch.index + statesMatch[0].length,
    );

    // Count unique owners
    const ownerSet = new Set<string>();
    for (const m of allMatches(OWNER_RE, statesBlock)) ownerSet.add(m[1]);
    activeCountries = ownerSet.size;

    // Per-state industry (entries are `\n\t123={`, owner comes AFTER buildings)
    for (const sm of allMatches(STATE_ENTRY_RE, statesBlock)) {
      const [stateBlock] = extractBlock(
        statesBlock,
        sm.index + sm[0].length, // position right after { in \n\t123={
      );
      const ownerM = OWNER_STATE_RE.exec(stateBlock);
      if (!ownerM) continue;
      const owner = ownerM[1];

      const bldM = BUILDINGS_RE.exec(stateBlock);
      if (!bldM) continue;
      const [bldBlock] = extractBlock(stateBlock, bldM.index + bldM[0].length);

      const mf = MIL_FAC_RE.exec(bldBlock);
      const cf = CIV_FAC_RE.exec(bldBlock);
      const dk = DOCKYARD_RE.exec(bldBlock);
      if (mf) acc(milFacByTag, owner, parseInt(mf[1]));
      if (cf) acc(civFacByTag, owner, parseInt(cf[1]));
      if (dk) acc(docksByTag, owner, parseInt(dk[1]));
    }
  }

  // ── Countries block: divisions + manpowerInField + equipment ──
  const eqByCountry: Record<string, Record<string, number>> = {};
  const countriesMatch = /\ncountries\s*=\s*\{/.exec(content);
  if (countriesMatch) {
    const [cb] = extractBlock(
      content,
      countriesMatch.index + countriesMatch[0].length,
    );
    const cms = allMatches(COUNTRY_TAG_RE, cb);

    for (let i = 0; i < cms.length; i++) {
      const owner = cms[i][1];
      const bs = cms[i].index + cms[i][0].length;
      const be = i + 1 < cms.length ? cms[i + 1].index : cb.length;
      const countryBlock = cb.slice(bs, be);

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
  for (const tag of Object.keys(docksByTag)) allTags.add(tag);
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
    aircraft: byCountry.reduce((n, r) => n + r.aircraft, 0),
    ships: byCountry.reduce((n, r) => n + r.ships, 0),
    militaryFactories: byCountry.reduce((n, r) => n + r.militaryFactories, 0),
    civilianFactories: byCountry.reduce((n, r) => n + r.civilianFactories, 0),
    dockyards: byCountry.reduce((n, r) => n + r.dockyards, 0),
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
