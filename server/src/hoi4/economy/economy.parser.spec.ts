import { buildCountryProductionIndex } from '../country-production.index';
import { findDirectBlocks } from '../naval-loss/global-history.parser';
import { parseEconomy } from './economy.parser';
import {
  ECONOMY_RESOURCES,
  type EconomyAnalysis,
  type EconomyResource,
} from './economy.types';
import { economyFixture } from './fixtures/economy.fixture';

function resource(economy: EconomyAnalysis, name: EconomyResource) {
  return economy.countrySummaries
    .find((country) => country.countryTag === 'GER')!
    .resources.find((entry) => entry.resource === name)!;
}

describe('serialized Economy parser', () => {
  test.each([
    ['aluminium', 414, null, null, 187, 165],
    ['rubber', 128, 5.57792, null, 105, 9.57792],
    ['tungsten', 12, 48, 10, 137, -95],
    ['steel', 897, null, 28, 773, -64],
    ['chromium', 35, 32, 10, 90, -38],
    ['coal', 611, null, null, 467, 48],
  ] as const)(
    'preserves A %s ledger',
    (name, extracted, imported, projects, demand, balance) => {
      const summary = resource(parseEconomy(economyFixture()), name);
      expect(summary.extracted).toBe(extracted);
      expect(summary.imported).toBe(imported);
      expect(summary.projectDemand).toBe(projects);
      expect(summary.productionDemand.total).toBe(demand);
      expect(summary.serializedProductionDemand).toBe(demand);
      expect(summary.serializedBalance).toBe(balance);
    },
  );

  test('aggregates military, naval, refit, and coal energy demand without using need', () => {
    const parsed = parseEconomy(economyFixture());
    expect(resource(parsed, 'steel').productionDemand).toEqual({
      military: 706,
      naval: 67,
      refit: 0,
      energy: null,
      total: 773,
    });
    expect(resource(parsed, 'chromium').productionDemand).toEqual({
      military: 89,
      naval: 1,
      refit: 0,
      energy: null,
      total: 90,
    });
    expect(resource(parsed, 'coal').productionDemand).toEqual({
      military: null,
      naval: null,
      refit: null,
      energy: 467,
      total: 467,
    });
    const changedNeed = parseEconomy(
      economyFixture().replaceAll('need=0', 'need=999'),
    );
    expect(changedNeed).toEqual(parsed);
    expect(resource(parsed, 'tungsten').productionDemand.total).toBe(137);
  });

  test('preserves missing vs explicit zero for every direct resource map', () => {
    const parsed = parseEconomy(`countries={ GER={
      resources={ produced={steel=0} imported={steel=0} base_export={steel=0}
        to_export={steel=0} exported={steel=0} transfer_overlord_subject={steel=0}
        to_use={ { steel=0 } { steel=0 } { steel=0 } }
      }
      program_status={project_pool={resources={steel=0}}}
      production={energy_production_cost={resource=coal amount=0 need=0}}
    } }`);
    const steel = resource(parsed, 'steel');
    for (const field of [
      'extracted',
      'imported',
      'baseExport',
      'exportAllocation',
      'savedExported',
      'transferOverlordSubject',
      'projectDemand',
      'serializedAvailableBeforeDemand',
      'serializedProjectDemand',
      'serializedProductionDemand',
      'serializedBalance',
    ] as const) {
      expect(steel[field]).toBe(0);
      expect(resource(parsed, 'aluminium')[field]).toBeNull();
    }
    expect(resource(parsed, 'coal').productionDemand.energy).toBe(0);
    expect(resource(parsed, 'coal').productionDemand.total).toBe(0);
    expect(steel.productionDemand.total).toBeNull();
  });

  test('keeps export allocation, base export, exported summary and saved ledger distinct', () => {
    const a = parseEconomy(economyFixture());
    expect(resource(a, 'steel')).toMatchObject({
      baseExport: 134.55,
      exportAllocation: 160,
      savedExported: 160,
    });
    // The fractional quota is not substituted into the initialized saved ledger.
    expect(resource(a, 'aluminium')).toMatchObject({
      exportAllocation: 62.1,
      savedExported: 56,
      serializedAvailableBeforeDemand: 352,
      serializedBalance: 165,
    });
    const b = resource(parseEconomy(economyFixture('B')), 'steel');
    expect(b).toMatchObject({
      extracted: 1184,
      imported: null,
      baseExport: 178,
      exportAllocation: 178,
      savedExported: 160,
      serializedBalance: 205,
    });
  });

  test('parses the POR land trade in exporter -> receiver direction', () => {
    const trade = parseEconomy(economyFixture()).commercialTrades.find(
      (record) => record.exporterTag === 'POR',
    )!;
    expect(trade).toMatchObject({
      relationRef: { id: 136587, type: 4713 },
      exporterTag: 'POR',
      importerTag: 'GER',
      resource: 'tungsten',
      deliveredRaw: 48,
      requiredCic: 6,
      lendedCic: 6,
      efficiency: 1,
      efficiencyDueToLostConvoys: 1,
      requestRaw: 0,
      convoySubscriber: null,
      warnings: [],
    });
    expect(trade.route).toMatchObject({
      routeType: 'land',
      senderTag: 'POR',
      receiverTag: 'GER',
      navalPath: null,
      landPath: [
        112, 180, 174, 790, 792, 806, 31, 22, 20, 17, 28, 42, 55, 60, 64,
      ],
    });
    expect(trade).not.toHaveProperty('nominalAmount');
  });

  test('preserves INS fractional sea delivery, loss efficiency and 9/9 convoys', () => {
    const trade = parseEconomy(economyFixture()).commercialTrades.find(
      (record) => record.exporterTag === 'INS',
    )!;
    expect(trade).toMatchObject({
      relationRef: { id: 144352, type: 4713 },
      deliveredRaw: 5.57792,
      efficiency: 1,
      efficiencyDueToLostConvoys: 0.69724,
      requiredCic: 1,
      lendedCic: 1,
      requestRaw: 9,
      convoySubscriber: { convoys: 9, total: 9 },
      warnings: [],
    });
    expect(trade.route).toMatchObject({
      routeType: 'sea',
      senderTag: 'INS',
      receiverTag: 'GER',
      landPath: null,
      navalPath: [72, 71, 60, 104, 100, 69, 29, 68, 47, 42, 18],
    });
    expect(resource(parseEconomy(economyFixture()), 'rubber').imported).toBe(
      5.57792,
    );
  });

  test('does not replace B imported Rubber with the current incoming delivered sum', () => {
    const b = parseEconomy(economyFixture('B'));
    expect(
      b.commercialTrades.find((record) => record.exporterTag === 'INS')!
        .deliveredRaw,
    ).toBe(4.46688);
    expect(resource(b, 'rubber').imported).toBe(5.57792);
  });

  test('preserves RKB delivered=32 separately from GER imported=24 and balance=229', () => {
    const c = parseEconomy(economyFixture('C'));
    expect(
      c.commercialTrades.find((record) => record.exporterTag === 'RKB'),
    ).toMatchObject({
      relationRef: { id: 147945, type: 4713 },
      importerTag: 'GER',
      resource: 'steel',
      deliveredRaw: 32,
      requiredCic: 1,
      lendedCic: 1,
      route: { routeType: 'land' },
      convoySubscriber: null,
      warnings: [],
    });
    expect(resource(c, 'steel')).toMatchObject({
      extracted: 1184,
      imported: 24,
      exportAllocation: 178,
      projectDemand: 28,
      productionDemand: { total: 773 },
      serializedBalance: 229,
    });
  });

  test('keeps SWE rights separate and never double counts them into national summaries', () => {
    const a = parseEconomy(economyFixture());
    expect(a.resourceRightsOrigins).toHaveLength(1);
    expect(a.resourceRightsOrigins[0]).toMatchObject({
      beneficiaryTag: 'GER',
      giverTag: 'SWE',
      stateId: 918,
      originRef: { id: 76538, type: 4713 },
      resources: {
        tungsten: 39.2,
        steel: 43.68,
        chromium: 16.8,
        aluminium: null,
      },
      resourcesUnclamped: { tungsten: 39.2, steel: 43.68, chromium: 16.8 },
      efficiency: 1,
      efficiencyDueToLostConvoys: 1,
      requestRaw: 0,
      route: { routeType: 'land', senderTag: 'SWE', receiverTag: 'GER' },
      convoySubscriber: null,
      warnings: [],
    });
    expect(a.resourceRightsOrigins[0].givenResourceRights).toHaveLength(6);
    expect(resource(a, 'tungsten')).toMatchObject({
      extracted: 12,
      imported: 48,
      serializedBalance: -95,
    });
    expect(
      a.commercialTrades.some((trade) => trade.exporterTag === 'SWE'),
    ).toBe(false);
  });

  test('keeps A/B serialized differences despite identical rights origins and nominal demand', () => {
    const a = parseEconomy(economyFixture());
    const b = parseEconomy(economyFixture('B'));
    expect(a.resourceRightsOrigins).toEqual(b.resourceRightsOrigins);
    for (const [name, produced] of [
      ['aluminium', 485],
      ['rubber', 128],
      ['tungsten', 118],
      ['steel', 1184],
      ['chromium', 84],
      ['coal', 737],
    ] as const) {
      expect(resource(b, name).extracted).toBe(produced);
      expect(resource(a, name).productionDemand).toEqual(
        resource(b, name).productionDemand,
      );
    }
    expect(resource(a, 'tungsten').serializedBalance).toBe(-95);
    expect(resource(b, 'tungsten').serializedBalance).toBe(1);
  });

  test('excludes Oil/Fuel and nested decoys without changing internal tags/resource identifiers', () => {
    const input = economyFixture().replace(
      'countries={',
      'decoy={ countries={ GER={ resources={ produced={steel=9999} } } } } countries={',
    );
    const parsed = parseEconomy(input);
    expect(parsed.stateBasis).toBe('serialized');
    expect(
      parsed.countrySummaries[0].resources.map((row) => row.resource),
    ).toEqual(ECONOMY_RESOURCES);
    expect(resource(parsed, 'steel').extracted).toBe(897);
    expect(JSON.stringify(parsed)).not.toMatch(/"(?:oil|fuel)"/);
  });

  test('reuses the supplied analysis-scoped country index deterministically', () => {
    const text = economyFixture();
    const index = buildCountryProductionIndex(
      text,
      findDirectBlocks(text, 0, text.length),
    );
    expect(parseEconomy(text, index)).toEqual(parseEconomy(text));
    expect(parseEconomy(text, index)).toEqual(parseEconomy(text, index));
    expect(parseEconomy(text, [])).toEqual({
      stateBasis: 'serialized',
      countrySummaries: [],
      commercialTrades: [],
      resourceRightsOrigins: [],
    });
  });

  test.each([
    'to_use={ {steel=10} {steel=-2} }',
    'to_use={ {steel=10} {steel=-2} {steel=-3} {steel=-4} }',
    'to_use={ available={steel=10} projects={steel=-2} production={steel=-3} }',
    'to_use={ {steel=10} {steel=2} {steel=-3} }',
    'to_use={ {steel=10} {steel=-2} {steel=broken} }',
  ])(
    'does not guess unsupported or malformed ledger semantics: %s',
    (toUse) => {
      const parsed = parseEconomy(
        `countries={ GER={ resources={produced={steel=10} ${toUse}} } }`,
      );
      expect(resource(parsed, 'steel').serializedBalance).toBeNull();
      expect(parsed.countrySummaries[0].warnings.length).toBeGreaterThan(0);
      expect(resource(parsed, 'steel').extracted).toBe(10);
    },
  );

  test('invalid source numbers remain null; missing amounts never become a complete production total', () => {
    const parsed =
      parseEconomy(`countries={ GER={ resources={produced={steel=bad}}
      production={ military_lines={resources={{resource=steel amount=5}}}
        naval_lines={resources={{resource=steel need=0}}} }
    } }`);
    expect(resource(parsed, 'steel').extracted).toBeNull();
    expect(resource(parsed, 'steel').productionDemand.total).toBeNull();
    expect(parsed.countrySummaries[0].warnings).toContain(
      'missing or invalid naval_lines.steel.amount',
    );
  });

  test('retains optional unknown route and partial convoy data without inventing zero', () => {
    const parsed = parseEconomy(`countries={ POR={ resources={
      delivery_routes={ GER={type=9 land_path={112 broken}} }
      export={id={id=1 type=4713} receiver=GER resource=tungsten delivered=0
        convoys_subscriber={convoys=0} }
    } } }`);
    const trade = parsed.commercialTrades[0];
    expect(trade.route).toMatchObject({
      typeRaw: 9,
      routeType: null,
      landPath: null,
      navalPath: null,
    });
    expect(trade.convoySubscriber).toEqual({ convoys: 0, total: null });
    expect(trade.deliveredRaw).toBe(0);
    expect(trade.requiredCic).toBeNull();
    expect(trade.warnings).toContain('invalid land_path');
  });
});
