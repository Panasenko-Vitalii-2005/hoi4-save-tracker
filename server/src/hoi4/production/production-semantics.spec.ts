import { compareAnalysisResults } from '../../analyze/analysis-comparison.service';
import { projectEquipmentCountries } from '../../analyze/campaign-snapshot-projection-cache.service';
import { comparisonResult } from '../../analyze/fixtures/analysis-comparison.fixture';
import { parseEquipmentRegistry } from '../stockpile/equipment-registry.parser';
import { aggregateMilitaryProduction } from './military-production.aggregator';
import { parseMilitaryProductionLines } from './military-production.parser';
import {
  pak44ControlSave,
  PAK44_RUNTIME_ORACLE,
} from './fixtures/pak44-control.fixture';

function parse(text: string) {
  return parseMilitaryProductionLines(text, parseEquipmentRegistry(text));
}

function controlResult(control: 'A' | 'B') {
  const result = comparisonResult({
    game_date: `1944.5.1.${control === 'A' ? 2 : 3}`,
  });
  result.stockpileSummaries = [];
  result.militaryProductionSummaries = aggregateMilitaryProduction(
    parse(pak44ControlSave(control)),
  );
  return result;
}

describe('PaK 44 saved-state semantics and legacy compatibility', () => {
  test('identical nominal demand/need and speed/cost coexist with different observed runtime supply/output', () => {
    const a = parse(pak44ControlSave('A'))[0];
    const b = parse(pak44ControlSave('B'))[0];
    expect(a).toMatchObject({
      lineRef: { type: 56, id: 1738 },
      speed: 84.64039,
      cost: 5.82,
      produced: 4.58278,
    });
    expect(a.resources).toEqual(b.resources);
    expect(a.resources).toContainEqual({
      resource: 'tungsten',
      amount: 22,
      need: 0,
      warnings: [],
    });
    const lineA = aggregateMilitaryProduction([a])[0].definitions[0].lines[0];
    const lineB = aggregateMilitaryProduction([b])[0].definitions[0].lines[0];
    expect(lineA).toEqual(lineB);
    expect(lineA.currentItemsPerDay).toBe(84.64039 / 5.82);
    expect(lineA.resourceShortages).toEqual([]);
    expect(lineA.hasResourceShortage).toBe(false); // Legacy diagnostic only.
    expect(PAK44_RUNTIME_ORACLE.A.suppliedTungsten).not.toBe(
      PAK44_RUNTIME_ORACLE.B.suppliedTungsten,
    );
    expect(PAK44_RUNTIME_ORACLE.A.itemsPerDay).not.toBe(
      PAK44_RUNTIME_ORACLE.B.itemsPerDay,
    );
    expect(lineA.currentItemsPerDay).not.toBe(
      PAK44_RUNTIME_ORACLE.A.itemsPerDay,
    );
    expect(lineA).not.toHaveProperty('suppliedResources');
    expect(lineA).not.toHaveProperty('runtimeShortage');
    expect(lineA).not.toHaveProperty('realizedItemsPerDay');
  });

  test('legacy JSON roundtrip preserves exact arithmetic and exact definition identity in Compare and Trends projection', () => {
    const a = controlResult('A');
    const b = JSON.parse(JSON.stringify(controlResult('B'))) as typeof a;
    const comparison = compareAnalysisResults('a', 'b', a, b);
    const production = comparison.equipmentProduction[0].definitions[0];
    expect(production.equipmentDefinition).toBe('anti_tank_equipment_3');
    expect(production.production?.currentItemsPerDay).toMatchObject({
      before: 84.64039 / 5.82,
      after: 84.64039 / 5.82,
      delta: 0,
      baseComplete: true,
      targetComplete: true,
    });
    expect(projectEquipmentCountries(a)).toEqual(projectEquipmentCountries(b));
    expect(projectEquipmentCountries(a)[0].definitions[0]).toMatchObject({
      equipmentDefinition: 'anti_tank_equipment_3',
      currentItemsPerDay: 84.64039 / 5.82,
      productionRateComplete: true,
    });
  });

  test('missing rate and positive-need amount remain unknown, with no fabricated runtime measurements', () => {
    const text = pak44ControlSave('A')
      .replace('speed=84.64039', '')
      .replace(
        'resource=tungsten amount=22 need=0',
        'resource=tungsten need=1',
      );
    const records = parse(text);
    expect(records[0].speed).toBeNull();
    expect(records[0].resources[0]).toMatchObject({ amount: null, need: 1 });
    const result = controlResult('A');
    result.militaryProductionSummaries = aggregateMilitaryProduction(records);
    const definition = result.militaryProductionSummaries[0].definitions[0];
    expect(definition.currentItemsPerDay).toBeNull();
    expect(definition.outputComplete).toBe(false);
    expect(definition.lines[0].resourceShortages[0]).toEqual({
      resource: 'tungsten',
      amount: null,
      need: 1,
    });
    expect(projectEquipmentCountries(result)[0].definitions[0]).toMatchObject({
      currentItemsPerDay: null,
      productionRateComplete: false,
    });
    expect(
      compareAnalysisResults('a', 'b', controlResult('A'), result)
        .equipmentProduction[0].definitions[0].production?.currentItemsPerDay,
    ).toMatchObject({ after: null, delta: null, targetComplete: false });
  });
});
