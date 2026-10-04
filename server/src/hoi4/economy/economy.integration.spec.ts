import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { analyzeSave } from '../hoi4-parser';
import { parseEconomy } from './economy.parser';
import { economyFixture } from './fixtures/economy.fixture';

describe('AnalyzeResult Economy integration', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'hoi4-economy-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  test('publishes additive Economy data through the normal analyzer result', () => {
    const path = join(directory, 'fixture.hoi4');
    const text = economyFixture('C');
    writeFileSync(path, text);
    const result = analyzeSave(path);
    expect(result.economy).toEqual(parseEconomy(text));
    expect(
      result.economy!.countrySummaries[0].resources.find(
        (row) => row.resource === 'steel',
      ),
    ).toMatchObject({ imported: 24, serializedBalance: 229 });
    expect(result.stockpileSummaries).toBeDefined();
    expect(result.fieldedEquipmentSummaries).toBeDefined();
    expect(result.militaryProductionSummaries).toBeDefined();
  });

  test('publishes an explicit empty Economy collection when the save has no resource blocks', () => {
    const path = join(directory, 'empty.hoi4');
    writeFileSync(path, 'HOI4txt\ncountries={}');
    expect(analyzeSave(path).economy).toEqual({
      stateBasis: 'serialized',
      countrySummaries: [],
      commercialTrades: [],
      resourceRightsOrigins: [],
    });
  });
});

// Real saves are not redistributed. These read-only checks run when the local
// research controls are present; compact derived fixtures always run in CI.
const controls = [
  ['A', 'autosave_100_reload_1192_control_temp.hoi4', 897, null, -64],
  ['B', 'post_load_1h_no_trade_control_temp.hoi4', 1184, null, 205],
  ['C', 'subject_trade_control_temp.hoi4', 1184, 24, 229],
] as const;
for (const [state, filename, produced, imported, balance] of controls) {
  const path = resolve(__dirname, '../../../../saves', filename);
  const testControl = existsSync(path) ? test : test.skip;
  testControl(
    `read-only real control ${state}: serialized economy anchors`,
    () => {
      const economy = parseEconomy(readFileSync(path, 'utf8'));
      const germany = economy.countrySummaries.find(
        (country) => country.countryTag === 'GER',
      )!;
      const steel = germany.resources.find(
        (resource) => resource.resource === 'steel',
      )!;
      expect(steel).toMatchObject({
        extracted: produced,
        imported,
        serializedBalance: balance,
        projectDemand: 28,
        productionDemand: { military: 706, naval: 67, refit: 0, total: 773 },
      });
      expect(germany.warnings).toEqual([]);
      expect(
        germany.resources.find((row) => row.resource === 'coal')!
          .productionDemand.energy,
      ).toBe(467);
      expect(
        germany.resources.find((row) => row.resource === 'rubber')!.imported,
      ).toBe(5.57792);
      expect(
        economy.resourceRightsOrigins.find(
          (origin) =>
            origin.beneficiaryTag === 'GER' && origin.giverTag === 'SWE',
        ),
      ).toMatchObject({
        stateId: 918,
        resources: { tungsten: 39.2, steel: 43.68, chromium: 16.8 },
      });
      expect(
        economy.commercialTrades.find(
          (trade) =>
            trade.exporterTag === 'POR' &&
            trade.importerTag === 'GER' &&
            trade.resource === 'tungsten',
        ),
      ).toMatchObject({
        deliveredRaw: 48,
        requiredCic: 6,
        lendedCic: 6,
        route: { routeType: 'land' },
        convoySubscriber: null,
      });
      expect(
        economy.commercialTrades.find(
          (trade) =>
            trade.exporterTag === 'INS' &&
            trade.importerTag === 'GER' &&
            trade.resource === 'rubber',
        ),
      ).toMatchObject({
        deliveredRaw: state === 'A' ? 5.57792 : 4.46688,
        convoySubscriber: { convoys: 9, total: 9 },
        route: { routeType: 'sea' },
      });
      if (state === 'C')
        expect(
          economy.commercialTrades.find(
            (trade) =>
              trade.exporterTag === 'RKB' &&
              trade.importerTag === 'GER' &&
              trade.resource === 'steel',
          ),
        ).toMatchObject({ deliveredRaw: 32, requiredCic: 1, lendedCic: 1 });
    },
    30_000,
  );
}
