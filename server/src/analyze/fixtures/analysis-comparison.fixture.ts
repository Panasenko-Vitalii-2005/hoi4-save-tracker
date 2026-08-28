import type {
  AnalyzeResult,
  CountryStats,
  CountryTotals,
} from '../../hoi4/hoi4-parser';

export const comparisonTotals = (): CountryTotals => ({
  divisions: 10,
  manpowerInField: 1000,
  manpowerCasualties: null,
  warCasualties: [],
  calculatedWarCasualtiesTotal: 20,
  aircraft: 5,
  ships: 2,
  militaryFactories: 100,
  civilianFactories: 200,
  dockyards: 300,
  shipProductionDockyards: 0,
  repairDockyards: 0,
  effectiveDockyards: 3,
  occupiedMilitaryFactories: 0,
  subjectMilitaryFactories: 0,
  subjectCivilianFactories: 0,
  occupiedCivilianFactories: 0,
  ownedCivilianFactories: 5,
  effectiveOwnMilitaryFactories: 4,
  effectiveMilitaryFactories: 4,
  tradeCivilianFactories: 0,
  effectiveCivilianFactories: 5,
});

export const comparisonCountry = (
  tag: string,
  fields: Partial<CountryStats> = {},
): CountryStats => ({
  tag,
  ...comparisonTotals(),
  ...fields,
});

export const comparisonResult = (
  fields: Partial<AnalyzeResult> = {},
): AnalyzeResult => ({
  game_date: '1944.5.1',
  file_size_mb: 1,
  parse_seconds: 0.1,
  active_countries: 1,
  totals: comparisonTotals(),
  by_country: [comparisonCountry('GER')],
  equipment_by_country: {},
  world_equipment: {},
  stockpileSummaries: [],
  militaryProductionSummaries: [],
  divisionSummaries: [],
  divisionTemplateCatalog: [],
  divisionEquipmentCatalog: [],
  armyHierarchySummaries: [],
  navalLosses: [],
  navalLossSummaries: [],
  navalKills: [],
  navalKillSummaries: [],
  navalKillerShipSummaries: [],
  ...fields,
});
