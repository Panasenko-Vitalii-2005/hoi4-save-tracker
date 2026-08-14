import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  COMPLETE_SUNK_SHIP,
  topLevelHistory,
} from './naval-loss/fixtures/global-history.fixture';
import { analyzeSave, type AnalyzeResult } from './hoi4-parser';
import { STOCKPILE_SCOPE_FIXTURE } from './stockpile/fixtures/stockpile.fixture';
import type { CountryStockpileSummary } from './stockpile/stockpile.types';

const EQUIPMENT_REGISTRY = `equipments={
  infantry_equipment_1={ id={ id=1 type=70 } name="Rifle" }
  light_tank_chassis_1={ id={ id=2 type=70 } name="M2A2" creator="USA" }
  light_tank_chassis_1={ id={ id=3 type=70 } name="M2 Light" creator="USA" }
  modded-equipment.alpha={ id={ id=4 type=170 } creator="D04" }
}`;

describe('analyzeSave stockpile integration', () => {
  const tempDirectory = mkdtempSync(
    join(tmpdir(), 'hoi4-stockpile-integration-'),
  );
  let fixtureNumber = 0;

  afterAll(() => {
    rmSync(tempDirectory, { recursive: true, force: true });
  });

  function analyzeText(content: string): AnalyzeResult {
    const filePath = join(tempDirectory, `fixture-${fixtureNumber++}.hoi4`);
    writeFileSync(filePath, content, 'latin1');
    return analyzeSave(filePath);
  }

  test('always exposes a non-optional empty stockpile summary list', () => {
    const result = analyzeText('HOI4txt\ndummy=1');
    const summaries: CountryStockpileSummary[] = result.stockpileSummaries;

    expect(summaries).toEqual([]);
  });

  test('publishes one country and one exact resolved design', () => {
    const result = analyzeText(`${EQUIPMENT_REGISTRY}
countries={
  GER={
    production={ equipments={
      equipment={ id={ id=1 type=70 } amount=49 }
    } }
  }
}`);

    expect(result.stockpileSummaries).toEqual([
      {
        countryTag: 'GER',
        definitions: [
          {
            definition: 'infantry_equipment_1',
            amount: 49,
            variants: [
              {
                equipmentRef: { id: 1, type: 70 },
                definition: 'infantry_equipment_1',
                variantName: 'Rifle',
                amount: 49,
                version: null,
                creatorTag: null,
                originTag: null,
                obsolete: false,
              },
            ],
          },
        ],
        unresolvedVariants: [],
      },
    ]);
  });

  test('preserves countries, definitions, exact variants and signed decimals', () => {
    const result = analyzeText(`${EQUIPMENT_REGISTRY}
countries={
  USA={ production={ equipments={
    equipment={ id={ id=2 type=70 } amount=49 }
    equipment={ id={ id=3 type=70 } amount=327 }
    equipment={ id={ id=1 type=70 } amount=15555.42655 }
  } } }
  D04={ production={ equipments={
    equipment={ id={ id=4 type=170 } amount=-0.4816 }
  } } }
}`);

    expect(
      result.stockpileSummaries.map(({ countryTag }) => countryTag),
    ).toEqual(['D04', 'USA']);
    const usaTanks = result.stockpileSummaries[1].definitions.find(
      ({ definition }) => definition === 'light_tank_chassis_1',
    );
    expect(usaTanks?.amount).toBe(376);
    expect(
      usaTanks?.variants.map(({ equipmentRef, variantName, amount }) => ({
        equipmentRef,
        variantName,
        amount,
      })),
    ).toEqual([
      {
        equipmentRef: { id: 3, type: 70 },
        variantName: 'M2 Light',
        amount: 327,
      },
      {
        equipmentRef: { id: 2, type: 70 },
        variantName: 'M2A2',
        amount: 49,
      },
    ]);
    expect(result.stockpileSummaries[1].definitions[0].amount).toBe(
      15555.42655,
    );
    expect(result.stockpileSummaries[0].definitions[0].amount).toBe(-0.4816);
  });

  test('retains unresolved numeric references in the public result', () => {
    const result = analyzeText(`${EQUIPMENT_REGISTRY}
countries={ GER={ production={ equipments={
  equipment={ id={ id=999 type=70 } amount=-0.8 }
} } } }`);

    expect(result.stockpileSummaries[0]).toEqual({
      countryTag: 'GER',
      definitions: [],
      unresolvedVariants: [
        { equipmentRef: { id: 999, type: 70 }, amount: -0.8 },
      ],
    });
  });

  test('continues after malformed records and excludes their null amounts', () => {
    const result = analyzeText(`${EQUIPMENT_REGISTRY}
countries={ GER={ production={ equipments={
  equipment={ id={ id=1 type=70 } amount=broken }
  equipment={ id={ id=1 type=70 } amount=293.2 }
} } } }`);

    expect(result.stockpileSummaries[0].definitions[0].amount).toBe(293.2);
    expect(result.stockpileSummaries[0].definitions[0].variants).toHaveLength(
      1,
    );
  });

  test('counts only direct national stockpile entries', () => {
    const result = analyzeText(STOCKPILE_SCOPE_FIXTURE);

    expect(
      result.stockpileSummaries.map(({ countryTag }) => countryTag),
    ).toEqual(['D04', 'USA']);
    expect(
      result.stockpileSummaries.flatMap(({ definitions }) =>
        definitions.flatMap(({ variants }) =>
          variants.map(({ amount }) => amount),
        ),
      ),
    ).toEqual(expect.arrayContaining([-0.4816, 327, 49]));
    expect(JSON.stringify(result.stockpileSummaries)).not.toMatch(
      /999|888|777|666/,
    );
  });

  test('leaves existing analyzer outputs unchanged', () => {
    const commonPrefix = `${EQUIPMENT_REGISTRY}
date="1944.5.6.7"
states={
\t1={ buildings={ arms_factory={ level=2 } } owner="GER" }
}
war_relation={ first="GER" second="SOV" start_date="1941.6.12.2" first_casualties=12 second_casualties=34 }
${topLevelHistory(COMPLETE_SUNK_SHIP)}`;
    const country = (stockpile: string) => `countries={
\tGER={
    units={ division={ equipment={ id={ id=1 type=70 } amount=10 } } }
    ${stockpile}
  }
}`;
    const withoutStockpile = analyzeText(`${commonPrefix}\n${country('')}`);
    const withStockpile = analyzeText(
      `${commonPrefix}\n${country(
        'production={ equipments={ equipment={ id={ id=1 type=70 } amount=-0.5 } } }',
      )}`,
    );

    for (const key of [
      'game_date',
      'active_countries',
      'totals',
      'by_country',
      'equipment_by_country',
      'world_equipment',
      'warCasualties',
      'navalLosses',
      'navalLossSummaries',
      'navalKills',
      'navalKillSummaries',
      'navalKillerShipSummaries',
    ] as const) {
      expect(withStockpile[key]).toEqual(withoutStockpile[key]);
    }
    expect(withStockpile.stockpileSummaries[0].definitions[0].amount).toBe(
      -0.5,
    );
    expect(withStockpile.equipment_by_country.GER).toEqual({
      infantry_equipment_1: 10,
    });
  });

  test('does not mutate the save input or expose parser internals publicly', () => {
    const content = `${EQUIPMENT_REGISTRY}
countries={ GER={ production={ equipments={
  equipment={ id={ id=1 type=70 } amount=1 }
} } } }`;
    const filePath = join(tempDirectory, `fixture-${fixtureNumber++}.hoi4`);
    writeFileSync(filePath, content, 'latin1');
    const before = readFileSync(filePath);

    const result = analyzeSave(filePath);

    expect(readFileSync(filePath)).toEqual(before);
    const serialized = JSON.stringify(result.stockpileSummaries);
    expect(serialized).not.toContain('sourceOffset');
    expect(serialized).not.toContain('warnings');
    expect(serialized).not.toContain('registry');
    expect(serialized).not.toContain('records');
    expect(serialized).not.toContain('maxVersion');
  });
});
