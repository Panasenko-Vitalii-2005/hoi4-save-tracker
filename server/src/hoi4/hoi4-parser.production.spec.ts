import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  COMPLETE_SUNK_SHIP,
  topLevelHistory,
} from './naval-loss/fixtures/global-history.fixture';
import { analyzeSave, type AnalyzeResult } from './hoi4-parser';
import type { CountryMilitaryProductionSummary } from './production/production.types';

const EQUIPMENT_REGISTRY = `equipments={
  infantry_equipment_1={
    id={ id=10 type=70 }
    name="Rifle A"
    version=2
    creator="GER"
    origin="GER"
  }
  small_plane_airframe_2={
    id={ id=20 type=70 }
    name="Falcon"
    creator="USA"
  }
}`;

const COMPLETE_LINE = `military_lines={
  id={ id=1 type=56 }
  produced=2
  active_factories=4
  queued_factories=2
  damaged_factories=1
  priority=0
  amount=-1
  speed=12
  cost=3
  requested_factories=7
  equipment_variant_index={ id=10 type=70 }
  factory_efficiencies={ 100 90 80 70 1 }
  resources={
    { resource=steel amount=5 need=2 }
    { resource=rubber amount=1 need=0 }
  }
  industrial_manufacturer={ id=9 type=79 }
}`;

const MISSING_OPTIONALS_LINE = `military_lines={
  id={ id=2 type=56 }
  priority=1
  amount=-1
  cost=4
  requested_factories=3
  queued_factories=3
  equipment_variant_index={ id=20 type=70 }
  factory_efficiencies={ 50 40 30 }
  resources={ { resource=aluminium amount=2 need=0 } }
}`;

const UNRESOLVED_LINE = `military_lines={
  id={ id=3 type=56 }
  produced=1
  active_factories=1
  priority=0
  amount=-1
  speed=2
  cost=2
  requested_factories=1
  equipment_variant_index={ id=999 type=70 }
  factory_efficiencies={ 75 }
  resources={ { resource=steel amount=1 need=0 } }
}`;

const MALFORMED_LINE = `military_lines={
  id={ id=broken type=56 }
  priority=broken
  amount=broken
  speed=broken
  cost=broken
  equipment_variant_index={ id=10 type=70 }
  factory_efficiencies={ 10 broken-token }
  resources={ { resource=steel amount=broken need=1 } }
}`;

function country(tag: string, productionEntries: string): string {
  return `\t${tag}={
    production={
      ${productionEntries}
    }
  }`;
}

function productionSave(countries: string): string {
  return `HOI4txt
date="1944.5.1.2"
${EQUIPMENT_REGISTRY}
countries={
${countries}
}`;
}

describe('analyzeSave military production integration', () => {
  const tempDirectory = mkdtempSync(
    join(tmpdir(), 'hoi4-production-integration-'),
  );
  let fixtureNumber = 0;

  afterAll(() => {
    rmSync(tempDirectory, { recursive: true, force: true });
  });

  function analyzeText(content: string): AnalyzeResult {
    const filePath = join(tempDirectory, `fixture-${fixtureNumber++}.hoi4`);
    writeFileSync(filePath, content, 'utf8');
    return analyzeSave(filePath);
  }

  function oneLineResult(): AnalyzeResult {
    return analyzeText(productionSave(country('GER', COMPLETE_LINE)));
  }

  test('exposes a non-optional military production summary list', () => {
    const result = analyzeText('HOI4txt\ndummy=1');
    const summaries: CountryMilitaryProductionSummary[] =
      result.militaryProductionSummaries;

    expect(summaries).toEqual([]);
  });

  test('returns an empty list when the save has no military lines', () => {
    const result = analyzeText(productionSave(country('GER', 'equipments={}')));

    expect(result.militaryProductionSummaries).toEqual([]);
  });

  test('publishes one country with one military production line', () => {
    const [summary] = oneLineResult().militaryProductionSummaries;

    expect(summary).toMatchObject({
      countryTag: 'GER',
      lineCount: 1,
      definitionCount: 1,
    });
  });

  test('publishes multiple countries deterministically', () => {
    const result = analyzeText(
      productionSave(
        `${country('USA', COMPLETE_LINE)}\n${country('D04', MISSING_OPTIONALS_LINE)}`,
      ),
    );

    expect(
      result.militaryProductionSummaries.map(({ countryTag }) => countryTag),
    ).toEqual(['D04', 'USA']);
  });

  test('preserves the exact equipment definition', () => {
    const definition =
      oneLineResult().militaryProductionSummaries[0].definitions[0];

    expect(definition.equipmentDefinition).toBe('infantry_equipment_1');
  });

  test('preserves exact design metadata', () => {
    const line =
      oneLineResult().militaryProductionSummaries[0].definitions[0].lines[0];

    expect(line).toMatchObject({
      variantName: 'Rifle A',
      version: 2,
      creatorTag: 'GER',
      originTag: 'GER',
      obsolete: false,
    });
  });

  test('keeps the line reference separate from the equipment reference', () => {
    const line =
      oneLineResult().militaryProductionSummaries[0].definitions[0].lines[0];

    expect(line.lineRef).toEqual({ id: 1, type: 56 });
    expect(line.equipmentRef).toEqual({ id: 10, type: 70 });
  });

  test('preserves requested, active, queued and damaged factories', () => {
    const [summary] = oneLineResult().militaryProductionSummaries;
    const line = summary.definitions[0].lines[0];

    expect(line).toMatchObject({
      requestedFactories: 7,
      activeFactories: 4,
      queuedFactories: 2,
      damagedFactories: 1,
    });
    expect(summary).toMatchObject({
      requestedFactories: 7,
      activeFactories: 4,
      queuedFactories: 2,
      damagedFactories: 1,
    });
  });

  test('aggregates missing active factories safely without changing null', () => {
    const [summary] = analyzeText(
      productionSave(country('D04', MISSING_OPTIONALS_LINE)),
    ).militaryProductionSummaries;
    const line = summary.definitions[0].lines[0];

    expect(line.activeFactories).toBeNull();
    expect(line.effectiveActiveFactories).toBe(0);
    expect(summary.activeFactories).toBe(0);
  });

  test('publishes current items per day', () => {
    const line =
      oneLineResult().militaryProductionSummaries[0].definitions[0].lines[0];

    expect(line.currentItemsPerDay).toBe(4);
  });

  test('keeps current items per day null when speed is absent', () => {
    const line = analyzeText(
      productionSave(country('D04', MISSING_OPTIONALS_LINE)),
    ).militaryProductionSummaries[0].definitions[0].lines[0];

    expect(line.currentItemsPerDay).toBeNull();
  });

  test('publishes progress as an unclamped fraction', () => {
    const line =
      oneLineResult().militaryProductionSummaries[0].definitions[0].lines[0];

    expect(line.progressFraction).toBe(2 / 3);
  });

  test('keeps progress null when produced is absent', () => {
    const line = analyzeText(
      productionSave(country('D04', MISSING_OPTIONALS_LINE)),
    ).militaryProductionSummaries[0].definitions[0].lines[0];

    expect(line.progressFraction).toBeNull();
  });

  test('publishes active-slot efficiency metrics', () => {
    const line =
      oneLineResult().militaryProductionSummaries[0].definitions[0].lines[0];

    expect(line).toMatchObject({
      activeEfficiencyAverage: 85,
      activeEfficiencyMin: 70,
      activeEfficiencyMax: 100,
    });
  });

  test('publishes only exact positive resource shortages', () => {
    const line =
      oneLineResult().militaryProductionSummaries[0].definitions[0].lines[0];

    expect(line.hasResourceShortage).toBe(true);
    expect(line.resourceShortages).toEqual([
      { resource: 'steel', amount: 5, need: 2 },
    ]);
  });

  test('does not report a shortage when every need is zero', () => {
    const line = analyzeText(
      productionSave(country('D04', MISSING_OPTIONALS_LINE)),
    ).militaryProductionSummaries[0].definitions[0].lines[0];

    expect(line.hasResourceShortage).toBe(false);
    expect(line.resourceShortages).toEqual([]);
  });

  test('preserves dynamic country tags', () => {
    const [summary] = analyzeText(
      productionSave(country('D04', MISSING_OPTIONALS_LINE)),
    ).militaryProductionSummaries;

    expect(summary.countryTag).toBe('D04');
  });

  test('preserves unresolved equipment lines', () => {
    const [summary] = analyzeText(
      productionSave(country('GER', UNRESOLVED_LINE)),
    ).militaryProductionSummaries;

    expect(summary.definitions).toEqual([]);
    expect(summary.unresolvedLines).toHaveLength(1);
    expect(summary.unresolvedLines[0]).toMatchObject({
      equipmentRef: { id: 999, type: 70 },
      currentItemsPerDay: 1,
      complete: false,
    });
  });

  test('excludes naval production lines', () => {
    const navalLine = `naval_lines={
      id={ id=1 type=57 }
      equipment_variant_index={ id=10 type=70 }
    }`;
    const result = analyzeText(productionSave(country('GER', navalLine)));

    expect(result.militaryProductionSummaries).toEqual([]);
  });

  test('keeps overall analysis alive after a malformed production line', () => {
    const result = analyzeText(
      productionSave(country('GER', `${MALFORMED_LINE}\n${COMPLETE_LINE}`)),
    );
    const [summary] = result.militaryProductionSummaries;

    expect(result.game_date).toBe('1944.5.1');
    expect(summary.lineCount).toBe(2);
    expect(summary.definitions[0].lines.some(({ complete }) => !complete)).toBe(
      true,
    );
  });

  const regressionCountry = (productionLine: string) => `countries={
\tGER={
    units={ division={ equipment={ id={ id=10 type=70 } amount=10 } } }
    production={
      equipments={ equipment={ id={ id=10 type=70 } amount=49 } }
      ${productionLine}
    }
  }
}`;
  const regressionPrefix = `${EQUIPMENT_REGISTRY}
date="1944.5.6.7"
states={
\t1={ buildings={ arms_factory={ level=2 } industrial_complex={ level=3 } dockyard={ level=1 } } owner="GER" }
}
war_relation={ first="GER" second="SOV" start_date="1941.6.12.2" first_casualties=12 second_casualties=34 }
${topLevelHistory(COMPLETE_SUNK_SHIP)}`;
  let withoutProduction: AnalyzeResult;
  let withProduction: AnalyzeResult;

  beforeAll(() => {
    withoutProduction = analyzeText(
      `${regressionPrefix}\n${regressionCountry('')}`,
    );
    withProduction = analyzeText(
      `${regressionPrefix}\n${regressionCountry(COMPLETE_LINE)}`,
    );
  });

  test('leaves existing CountryStats output unchanged', () => {
    expect(withProduction.by_country).toEqual(withoutProduction.by_country);
    expect(withProduction.totals).toEqual(withoutProduction.totals);
  });

  test('leaves deployed equipment output unchanged', () => {
    expect(withProduction.equipment_by_country).toEqual(
      withoutProduction.equipment_by_country,
    );
    expect(withProduction.world_equipment).toEqual(
      withoutProduction.world_equipment,
    );
  });

  test('leaves War Casualties output unchanged', () => {
    expect(withProduction.warCasualties).toEqual(
      withoutProduction.warCasualties,
    );
  });

  test('leaves Naval Losses output unchanged', () => {
    expect(withProduction.navalLosses).toEqual(withoutProduction.navalLosses);
    expect(withProduction.navalLossSummaries).toEqual(
      withoutProduction.navalLossSummaries,
    );
  });

  test('leaves Naval Kills output unchanged', () => {
    expect(withProduction.navalKills).toEqual(withoutProduction.navalKills);
    expect(withProduction.navalKillSummaries).toEqual(
      withoutProduction.navalKillSummaries,
    );
    expect(withProduction.navalKillerShipSummaries).toEqual(
      withoutProduction.navalKillerShipSummaries,
    );
  });

  test('leaves Stockpile output unchanged', () => {
    expect(withProduction.stockpileSummaries).toEqual(
      withoutProduction.stockpileSummaries,
    );
  });

  test('does not mutate the save input', () => {
    const content = productionSave(country('GER', COMPLETE_LINE));
    const filePath = join(tempDirectory, `fixture-${fixtureNumber++}.hoi4`);
    writeFileSync(filePath, content, 'utf8');
    const before = readFileSync(filePath);

    analyzeSave(filePath);

    expect(readFileSync(filePath)).toEqual(before);
  });

  test('does not expose production parser internals publicly', () => {
    const result = oneLineResult();
    const line = result.militaryProductionSummaries[0].definitions[0].lines[0];
    const serialized = JSON.stringify(result.militaryProductionSummaries);

    expect(line).not.toHaveProperty('sourceOffset');
    expect(line).not.toHaveProperty('factoryEfficiencies');
    expect(line).not.toHaveProperty('resources');
    expect(result).not.toHaveProperty('equipmentRegistry');
    expect(result).not.toHaveProperty('topLevelBlocks');
    expect(serialized).not.toContain('factoryEfficiencies');
  });
});
