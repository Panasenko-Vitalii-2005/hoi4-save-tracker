import type { AnalyzeResult } from '../hoi4/hoi4-parser';
import type { SaveComparisonContext } from '../hoi4/save-comparison-context';
import type { MilitaryProductionDefinitionSummary } from '../hoi4/production/production.types';
import { comparisonResult } from './fixtures/analysis-comparison.fixture';
import { CampaignTrendsService } from './campaign-trends.service';
import { CampaignSnapshotProjectionCacheService } from './campaign-snapshot-projection-cache.service';
import type { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import type { PersistedResultFingerprint } from './persisted-analysis-result.service';
import type {
  RecentAnalysesService,
  RecentAnalysis,
} from './recent-analyses.service';

const hash = (letter: string) => letter.repeat(64);
const item = (
  letter: string,
  gameDate: string,
  analyzedAt: string,
): RecentAnalysis => ({
  hash: hash(letter),
  fileName: `${letter}.hoi4`,
  fileSizeBytes: 100,
  analyzedAt,
  gameDate,
  countryCount: 1,
  divisionCount: 10,
  shipCount: 2,
  navalLossCount: 0,
  manpowerInField: 1000,
  aircraftCount: 5,
  hasPersistedResult: true,
  pinned: false,
});
const context = (
  campaignId: string | null,
  gameVersion = '1.19.2',
  playerCountryTag?: string | null,
): SaveComparisonContext => ({ campaignId, gameVersion, playerCountryTag });
const fingerprint = (
  bytes = 1000,
  mtimeMs = 1,
  ctimeMs = 1,
): PersistedResultFingerprint => ({ bytes, mtimeMs, ctimeMs });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error('Timed out waiting for condition');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe('CampaignTrendsService', () => {
  const campaignA = '0731c3c7-035e-46b1-b07b-6c35b27e8dc2';
  const campaignB = '016a6f0b-47b4-4812-a626-73537dcc5c56';
  let entries: RecentAnalysis[];
  let artifacts: Map<
    string,
    { result: AnalyzeResult; comparisonContext: SaveComparisonContext }
  >;
  let inventory: Map<string, PersistedResultFingerprint>;
  let recent: Pick<RecentAnalysesService, 'list'>;
  let results: Pick<
    PersistedAnalysisResultService,
    'getWithContext' | 'fingerprintInventory'
  >;
  let projections: CampaignSnapshotProjectionCacheService;
  let service: CampaignTrendsService;

  beforeEach(() => {
    entries = [];
    artifacts = new Map();
    inventory = new Map();
    recent = { list: jest.fn(() => Promise.resolve(entries)) };
    results = {
      getWithContext: jest.fn((key: string) =>
        Promise.resolve(artifacts.get(key) ?? null),
      ),
      fingerprintInventory: jest.fn(() => Promise.resolve(new Map(inventory))),
    };
    projections = new CampaignSnapshotProjectionCacheService(
      results as unknown as PersistedAnalysisResultService,
    );
    service = new CampaignTrendsService(
      recent as RecentAnalysesService,
      results as PersistedAnalysisResultService,
      projections,
    );
  });

  const add = (
    entry: RecentAnalysis,
    campaignId: string | null,
    result = comparisonResult({ game_date: entry.gameDate }),
    playerCountryTag?: string | null,
  ) => {
    entries.push(entry);
    artifacts.set(entry.hash, {
      result,
      comparisonContext: context(campaignId, '1.19.2', playerCountryTag),
    });
    inventory.set(entry.hash, fingerprint(1000 + entry.hash.length));
  };

  const reads = () => (results.getWithContext as jest.Mock).mock.calls.length;

  test('groups matching UUIDs, separates known campaigns and sorts dates numerically', async () => {
    add(item('a', '1936.11.1', '2026-01-03T00:00:00Z'), campaignA);
    add(item('b', '1936.8.1', '2026-01-02T00:00:00Z'), campaignA);
    add(item('c', '1936.9.1', '2026-01-01T00:00:00Z'), campaignB);

    const dto = await service.build();
    expect(dto.snapshotCount).toBe(3);
    expect(dto.campaigns).toHaveLength(2);
    expect(dto.campaigns[0]).toMatchObject({
      campaignId: campaignA,
      relationship: 'known',
      snapshotCount: 2,
      firstGameDate: '1936.8.1',
      latestGameDate: '1936.11.1',
    });
    expect(dto.campaigns[0].snapshots.map(({ gameDate }) => gameDate)).toEqual([
      '1936.8.1',
      '1936.11.1',
    ]);
    expect(dto.campaigns[1].campaignId).toBe(campaignB);
  });

  test('loads only the ownership-filtered snapshots supplied by the controller', async () => {
    const owned = item('a', '1936.1.1', '2026-01-01T00:00:00Z');
    const foreign = item('b', '1936.2.1', '2026-01-02T00:00:00Z');
    add(owned, campaignA);
    add(foreign, campaignA);

    const dto = await service.build([owned]);

    expect(dto.snapshotCount).toBe(1);
    expect(dto.campaigns[0].snapshots.map((snapshot) => snapshot.hash)).toEqual(
      [owned.hash],
    );
    expect(results.getWithContext).toHaveBeenCalledTimes(1);
    expect(results.getWithContext).toHaveBeenCalledWith(owned.hash);
  });

  test('equipment trends use the same ownership-filtered snapshot set', async () => {
    const owned = item('a', '1936.1.1', '2026-01-01T00:00:00Z');
    const foreign = item('b', '1936.2.1', '2026-01-02T00:00:00Z');
    add(owned, campaignA);
    add(foreign, campaignA);

    const dto = await service.buildEquipment(`campaign:${campaignA}`, 'GER', [
      owned,
    ]);

    expect(dto.snapshotHashes).toEqual([owned.hash]);
    expect(results.getWithContext).toHaveBeenCalledTimes(1);
    expect(results.getWithContext).toHaveBeenCalledWith(owned.hash);
  });

  test('isolates every unknown legacy analysis instead of guessing continuity', async () => {
    add(item('a', '1936.1.1', '2026-01-01T00:00:00Z'), null);
    add(item('b', '1936.2.1', '2026-01-02T00:00:00Z'), null);
    const campaigns = (await service.build()).campaigns;
    expect(campaigns).toHaveLength(2);
    expect(campaigns.every((entry) => entry.relationship === 'unknown')).toBe(
      true,
    );
    expect(campaigns.map(({ snapshotCount }) => snapshotCount)).toEqual([1, 1]);
  });

  test('exposes one consistent player country as presentation metadata without changing UUID grouping', async () => {
    add(
      item('a', '1936.1.1', '2026-01-01T00:00:00Z'),
      campaignA,
      comparisonResult(),
      'GER',
    );
    add(
      item('b', '1936.2.1', '2026-01-02T00:00:00Z'),
      campaignA,
      comparisonResult(),
      'GER',
    );
    const campaigns = (await service.build()).campaigns;
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]).toMatchObject({
      campaignId: campaignA,
      playerCountryTag: 'GER',
      snapshotCount: 2,
    });
  });

  test('does not invent a primary country when persisted campaign tags conflict', async () => {
    add(
      item('a', '1936.1.1', '2026-01-01T00:00:00Z'),
      campaignA,
      comparisonResult(),
      'GER',
    );
    add(
      item('b', '1936.2.1', '2026-01-02T00:00:00Z'),
      campaignA,
      comparisonResult(),
      'USA',
    );
    const campaigns = (await service.build()).campaigns;
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].playerCountryTag).toBeNull();
  });

  test('preserves same-date snapshots and deterministically places malformed dates last', async () => {
    add(item('c', 'bad', '2026-01-01T00:00:00Z'), campaignA);
    add(item('b', '1936.8.1', '2026-01-03T00:00:00Z'), campaignA);
    add(item('a', '1936.8.1', '2026-01-02T00:00:00Z'), campaignA);
    const trend = (await service.build()).campaigns[0];
    expect(trend.snapshots.map(({ hash: key }) => key[0])).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(trend.firstGameDate).toBe('1936.8.1');
    expect(trend.latestGameDate).toBe('1936.8.1');
  });

  test('maps exact global/country metrics and preserves missing values as null', async () => {
    const parsed = comparisonResult();
    parsed.active_countries = 4;
    parsed.totals.divisions = 20;
    parsed.totals.manpowerInField = 2000;
    parsed.totals.aircraft = 30;
    parsed.totals.ships = 40;
    parsed.totals.effectiveMilitaryFactories = 50;
    parsed.totals.effectiveCivilianFactories = 60;
    parsed.totals.effectiveDockyards = 70;
    parsed.by_country[0].calculatedWarCasualtiesTotal = 80;
    (parsed.totals as unknown as Record<string, unknown>).aircraft = undefined;
    add(item('a', '1944.5.1', '2026-01-01T00:00:00Z'), campaignA, parsed);

    const saved = (await service.build()).campaigns[0].snapshots[0];
    expect(saved.metrics).toEqual({
      activeCountries: 4,
      divisions: 20,
      manpowerInField: 2000,
      aircraft: null,
      ships: 40,
      militaryFactories: 50,
      civilianFactories: 60,
      dockyards: 70,
    });
    expect(saved.countries[0]).toMatchObject({
      tag: 'GER',
      metrics: { calculatedCasualties: 80 },
    });
  });

  test('country absence stays absent rather than becoming a zero-valued country', async () => {
    const first = comparisonResult();
    const second = comparisonResult({ by_country: [] });
    add(item('a', '1944.5.1', '2026-01-01T00:00:00Z'), campaignA, first);
    add(item('b', '1944.6.1', '2026-01-02T00:00:00Z'), campaignA, second);
    const snapshots = (await service.build()).campaigns[0].snapshots;
    expect(snapshots[0].countries.map(({ tag }) => tag)).toEqual(['GER']);
    expect(snapshots[1].countries).toEqual([]);
  });

  test('returns a compact projection and never exposes parser-heavy collections', async () => {
    add(item('a', '1944.5.1', '2026-01-01T00:00:00Z'), campaignA);
    const serialized = JSON.stringify(await service.build());
    expect(serialized).not.toMatch(
      /equipment_by_country|world_equipment|divisionSummaries|navalLosses|sourceOffset|warnings/,
    );
    expect(reads()).toBe(1);
  });

  test('skips unavailable results and metadata-only entries without persisted reads', async () => {
    const missing = item('a', '1944.5.1', '2026-01-01T00:00:00Z');
    const unavailable = {
      ...item('b', '1944.6.1', '2026-01-02T00:00:00Z'),
      hasPersistedResult: false,
    };
    entries.push(missing, unavailable);
    expect(await service.build()).toEqual({ snapshotCount: 0, campaigns: [] });
    expect(reads()).toBe(0);
  });

  const equipmentResult = (
    gameDate: string,
    stockpile: [string, number][],
    production: Array<[string, number, number | null, boolean]> = [],
    countryTag = 'GER',
  ): AnalyzeResult => {
    const result = comparisonResult({ game_date: gameDate });
    result.stockpileSummaries = [
      {
        countryTag,
        definitions: stockpile.map(([definition, amount]) => ({
          definition,
          amount,
          variants: [],
        })),
        unresolvedVariants: [],
      },
    ];
    const definition = (
      equipmentDefinition: string,
      activeFactories: number,
      currentItemsPerDay: number | null,
      outputComplete: boolean,
    ): MilitaryProductionDefinitionSummary => ({
      equipmentDefinition,
      lineCount: 1,
      requestedFactories: activeFactories,
      activeFactories,
      queuedFactories: 0,
      damagedFactories: 0,
      currentItemsPerDay,
      knownCurrentItemsPerDay: currentItemsPerDay ?? 0,
      outputComplete,
      resourceShortageLineCount: 0,
      lines: [],
    });
    result.militaryProductionSummaries = [
      {
        countryTag,
        lineCount: production.length,
        definitionCount: production.length,
        requestedFactories: 0,
        activeFactories: 0,
        queuedFactories: 0,
        damagedFactories: 0,
        resourceShortageLineCount: 0,
        definitions: production.map((entry) => definition(...entry)),
        unresolvedLines: [],
      },
    ];
    return result;
  };

  test('discovers an exact deterministic definition union and keeps similarly named definitions distinct', async () => {
    add(
      item('a', '1936.1.1', '2026-01-01T00:00:00Z'),
      campaignA,
      equipmentResult('1936.1.1', [['modded_tank', 1]]),
    );
    add(
      item('b', '1936.2.1', '2026-01-02T00:00:00Z'),
      campaignA,
      equipmentResult('1936.2.1', [
        ['modded__tank', 2],
        ['infantry_equipment_1', 3],
      ]),
    );

    const dto = await service.buildEquipment(`campaign:${campaignA}`, 'GER');
    expect(dto.snapshotHashes.map((value) => value[0])).toEqual(['a', 'b']);
    expect(
      dto.definitions.map(({ equipmentDefinition }) => equipmentDefinition),
    ).toEqual(['infantry_equipment_1', 'modded__tank', 'modded_tank']);
  });

  test('preserves signed, fractional and measured-zero stockpile values while absence stays null', async () => {
    const first = equipmentResult('1936.1.1', [
      ['infantry_equipment_1', -1.25],
      ['support_equipment_1', 0],
    ]);
    first.stockpileSummaries[0].definitions.push({
      definition: 'infantry_equipment_1',
      amount: 0.5,
      variants: [],
    });
    add(item('a', '1936.1.1', '2026-01-01T00:00:00Z'), campaignA, first);
    add(
      item('b', '1936.2.1', '2026-01-02T00:00:00Z'),
      campaignA,
      equipmentResult('1936.2.1', [['support_equipment_1', 2]]),
    );

    const definitions = (
      await service.buildEquipment(`campaign:${campaignA}`, 'GER')
    ).definitions;
    expect(
      definitions.find(
        ({ equipmentDefinition }) =>
          equipmentDefinition === 'infantry_equipment_1',
      )?.stockpileBalance,
    ).toEqual([-0.75, null]);
    expect(
      definitions.find(
        ({ equipmentDefinition }) =>
          equipmentDefinition === 'support_equipment_1',
      )?.stockpileBalance,
    ).toEqual([0, 2]);
  });

  test('projects active factories and only complete finite production rates without matching transient refs', async () => {
    add(
      item('a', '1936.1.1', '2026-01-01T00:00:00Z'),
      campaignA,
      equipmentResult(
        '1936.1.1',
        [],
        [['small_plane_airframe_2', 0, 1.25, true]],
      ),
    );
    add(
      item('b', '1936.2.1', '2026-01-02T00:00:00Z'),
      campaignA,
      equipmentResult(
        '1936.2.1',
        [],
        [
          ['small_plane_airframe_2', 4, 9, false],
          ['modded_new_design', 2, 0.5, true],
        ],
      ),
    );

    const definitions = (
      await service.buildEquipment(`campaign:${campaignA}`, 'GER')
    ).definitions;
    expect(definitions[1]).toMatchObject({
      equipmentDefinition: 'small_plane_airframe_2',
      activeFactories: [0, 4],
      currentItemsPerDay: [1.25, null],
      productionRateComplete: [true, false],
    });
    expect(definitions[0]).toMatchObject({
      equipmentDefinition: 'modded_new_design',
      activeFactories: [null, 2],
      currentItemsPerDay: [null, 0.5],
      productionRateComplete: [null, true],
    });
  });

  test('uses exact campaign identity, keeps unknown histories isolated, and reads persisted results only', async () => {
    add(
      item('a', '1936.1.1', '2026-01-01T00:00:00Z'),
      campaignA,
      equipmentResult('1936.1.1', [['one', 1]]),
    );
    add(
      item('b', '1936.2.1', '2026-01-02T00:00:00Z'),
      campaignB,
      equipmentResult('1936.2.1', [['two', 2]]),
    );
    add(
      item('c', '1936.3.1', '2026-01-03T00:00:00Z'),
      null,
      equipmentResult('1936.3.1', [['legacy', 3]]),
    );

    const known = await service.buildEquipment(`campaign:${campaignA}`, 'GER');
    const legacy = await service.buildEquipment(`unknown:${hash('c')}`, 'GER');
    expect(
      known.definitions.map(({ equipmentDefinition }) => equipmentDefinition),
    ).toEqual(['one']);
    expect(
      legacy.definitions.map(({ equipmentDefinition }) => equipmentDefinition),
    ).toEqual(['legacy']);
    expect(recent.list).toHaveBeenCalledTimes(2);
    expect(reads()).toBe(3);
  });

  test('returns a compact projection without full stockpile variants or production lines', async () => {
    add(
      item('a', '1936.1.1', '2026-01-01T00:00:00Z'),
      campaignA,
      equipmentResult(
        '1936.1.1',
        [['unknown_mod_equipment', 4.5]],
        [['unknown_mod_equipment', 3, 2.5, true]],
      ),
    );
    const dto = await service.buildEquipment(`campaign:${campaignA}`, 'D01');
    expect(dto).toMatchObject({
      campaignKey: `campaign:${campaignA}`,
      countryTag: 'D01',
      definitions: [],
    });
    expect(JSON.stringify(dto)).not.toMatch(
      /variants|lines|equipmentRef|warnings/,
    );
  });

  test('warm same campaign and different countries reuse projections without full-result reads', async () => {
    add(
      item('a', '1936.1.1', '2026-01-01T00:00:00Z'),
      campaignA,
      equipmentResult('1936.1.1', [['ger_def', 1]], [], 'GER'),
    );
    add(
      item('b', '1936.2.1', '2026-01-02T00:00:00Z'),
      campaignA,
      equipmentResult('1936.2.1', [['usa_def', 2]], [], 'USA'),
    );

    const cold = await service.buildEquipment(`campaign:${campaignA}`, 'GER');
    expect(reads()).toBe(2);
    const warmSame = await service.buildEquipment(
      `campaign:${campaignA}`,
      'GER',
    );
    expect(reads()).toBe(2);
    expect(warmSame).toEqual(cold);
    const warmOther = await service.buildEquipment(
      `campaign:${campaignA}`,
      'USA',
    );
    expect(reads()).toBe(2);
    expect(
      warmOther.definitions.map(
        ({ equipmentDefinition }) => equipmentDefinition,
      ),
    ).toEqual(['usa_def']);
  });

  test('main trends warms the shared cache and equipment reuses it without rereads', async () => {
    add(
      item('a', '1936.1.1', '2026-01-01T00:00:00Z'),
      campaignA,
      equipmentResult('1936.1.1', [['ger_def', 1]]),
    );
    add(
      item('b', '1936.2.1', '2026-01-02T00:00:00Z'),
      campaignA,
      equipmentResult('1936.2.1', [['other_def', 2]]),
    );

    const mainCold = await service.build();
    expect(reads()).toBe(2);
    const mainWarm = await service.build();
    expect(reads()).toBe(2);
    expect(mainWarm).toEqual(mainCold);

    const equipment = await service.buildEquipment(
      `campaign:${campaignA}`,
      'GER',
    );
    expect(reads()).toBe(2);
    expect(
      equipment.definitions.map(
        ({ equipmentDefinition }) => equipmentDefinition,
      ),
    ).toEqual(['ger_def', 'other_def']);
  });

  test('adding one snapshot loads only the new artifact', async () => {
    add(
      item('a', '1936.1.1', '2026-01-01T00:00:00Z'),
      campaignA,
      equipmentResult('1936.1.1', [['one', 1]]),
    );
    add(
      item('b', '1936.2.1', '2026-01-02T00:00:00Z'),
      campaignA,
      equipmentResult('1936.2.1', [['two', 2]]),
    );
    await service.buildEquipment(`campaign:${campaignA}`, 'GER');
    expect(reads()).toBe(2);

    add(
      item('c', '1936.3.1', '2026-01-03T00:00:00Z'),
      campaignA,
      equipmentResult('1936.3.1', [['three', 3]]),
    );
    const dto = await service.buildEquipment(`campaign:${campaignA}`, 'GER');
    expect(reads()).toBe(3);
    expect(dto.snapshotHashes.map((value) => value[0])).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(
      dto.definitions.map(({ equipmentDefinition }) => equipmentDefinition),
    ).toEqual(['one', 'three', 'two']);
  });

  test('same-hash fingerprint change causes a reload instead of stale reuse', async () => {
    add(
      item('a', '1936.1.1', '2026-01-01T00:00:00Z'),
      campaignA,
      equipmentResult('1936.1.1', [['one', 1]]),
    );
    await service.buildEquipment(`campaign:${campaignA}`, 'GER');
    expect(reads()).toBe(1);

    const replacement = equipmentResult('1936.1.1', [['one', 5]]);
    artifacts.set(hash('a'), {
      result: replacement,
      comparisonContext: context(campaignA, '1.19.2'),
    });
    inventory.set(hash('a'), fingerprint(2000, 2, 2));

    const dto = await service.buildEquipment(`campaign:${campaignA}`, 'GER');
    expect(reads()).toBe(2);
    expect(dto.definitions[0].stockpileBalance).toEqual([5]);
  });

  test('deleted snapshot is never served from stale cache and remaining snapshots stay warm', async () => {
    add(
      item('a', '1936.1.1', '2026-01-01T00:00:00Z'),
      campaignA,
      equipmentResult('1936.1.1', [['one', 1]]),
    );
    add(
      item('b', '1936.2.1', '2026-01-02T00:00:00Z'),
      campaignA,
      equipmentResult('1936.2.1', [['two', 2]]),
    );
    await service.buildEquipment(`campaign:${campaignA}`, 'GER');
    expect(reads()).toBe(2);

    entries = entries.filter((entry) => entry.hash !== hash('a'));
    artifacts.delete(hash('a'));
    inventory.delete(hash('a'));

    const dto = await service.buildEquipment(`campaign:${campaignA}`, 'GER');
    expect(reads()).toBe(2);
    expect(dto.snapshotHashes.map((value) => value[0])).toEqual(['b']);
    expect(
      dto.definitions.map(({ equipmentDefinition }) => equipmentDefinition),
    ).toEqual(['two']);
  });

  test('campaign deletion shrinks membership without rereading warm snapshots', async () => {
    add(
      item('a', '1936.1.1', '2026-01-01T00:00:00Z'),
      campaignA,
      comparisonResult({ game_date: '1936.1.1' }),
    );
    await service.build();
    expect(reads()).toBe(1);

    entries = [];
    artifacts.clear();
    inventory.clear();
    const dto = await service.build();
    expect(reads()).toBe(1);
    expect(dto).toEqual({ snapshotCount: 0, campaigns: [] });
  });

  test('concurrent requests deduplicate persisted reads per hash', async () => {
    add(
      item('a', '1936.1.1', '2026-01-01T00:00:00Z'),
      campaignA,
      equipmentResult('1936.1.1', [['one', 1]]),
    );
    const getWithContext = results.getWithContext as jest.Mock;
    const initial = getWithContext.getMockImplementation()!;
    const pending = deferred<{
      result: AnalyzeResult;
      comparisonContext: SaveComparisonContext;
    }>();
    getWithContext.mockReturnValueOnce(pending.promise);

    const first = service.buildEquipment(`campaign:${campaignA}`, 'GER');
    const second = service.buildEquipment(`campaign:${campaignA}`, 'GER');
    await waitFor(() => getWithContext.mock.calls.length === 1);
    pending.resolve(artifacts.get(hash('a'))!);

    const [a, b] = await Promise.all([first, second]);
    expect(getWithContext).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a.definitions).toHaveLength(1);
    // Restore the default mock for the remaining lifecycle.
    getWithContext.mockImplementation(initial);
  });

  test('mutation during a build retries once against the new state without mixed generations', async () => {
    add(
      item('a', '1936.1.1', '2026-01-01T00:00:00Z'),
      campaignA,
      equipmentResult('1936.1.1', [['one', 1]]),
    );
    const first = fingerprint(1000, 1, 1);
    const second = fingerprint(2000, 2, 2);
    const versions = [first, second, second, second];
    let call = 0;
    (results.fingerprintInventory as jest.Mock).mockImplementation(() => {
      const version = versions[call++ % versions.length];
      // The artifact is replaced at the same time its fingerprint changes.
      if (version !== first) {
        artifacts.set(hash('a'), {
          result: equipmentResult('1936.1.1', [['one', 5]]),
          comparisonContext: context(campaignA, '1.19.2'),
        });
      }
      return Promise.resolve(new Map([[hash('a'), version]]));
    });

    const dto = await service.buildEquipment(`campaign:${campaignA}`, 'GER');
    expect(reads()).toBe(2);
    expect(dto.definitions[0].stockpileBalance).toEqual([5]);
    expect((results.fingerprintInventory as jest.Mock).mock.calls.length).toBe(
      4,
    );
  });

  test('a snapshot added mid-build appears in the retried response', async () => {
    add(
      item('a', '1936.1.1', '2026-01-01T00:00:00Z'),
      campaignA,
      comparisonResult({ game_date: '1936.1.1' }),
    );
    const getWithContext = results.getWithContext as jest.Mock;
    const initial = getWithContext.getMockImplementation()!;
    const pending = deferred<{
      result: AnalyzeResult;
      comparisonContext: SaveComparisonContext;
    }>();
    getWithContext.mockReturnValueOnce(pending.promise);

    const build = service.build();
    await waitFor(() => getWithContext.mock.calls.length === 1);
    // The new snapshot lands while the first attempt is still loading.
    add(
      item('b', '1936.2.1', '2026-01-02T00:00:00Z'),
      campaignA,
      comparisonResult({ game_date: '1936.2.1' }),
    );
    pending.resolve(artifacts.get(hash('a'))!);
    getWithContext.mockImplementation(initial);

    const dto = await build;
    expect(dto.snapshotCount).toBe(2);
    expect(dto.campaigns[0].snapshots.map(({ hash: key }) => key[0])).toEqual([
      'a',
      'b',
    ]);
  });

  test('continuous mutation fails through the typed data-changed error instead of looping', async () => {
    add(
      item('a', '1936.1.1', '2026-01-01T00:00:00Z'),
      campaignA,
      equipmentResult('1936.1.1', [['one', 1]]),
    );
    const states = [
      fingerprint(1, 1, 1),
      fingerprint(2, 2, 2),
      fingerprint(3, 3, 3),
      fingerprint(4, 4, 4),
    ];
    let call = 0;
    (results.fingerprintInventory as jest.Mock).mockImplementation(() =>
      Promise.resolve(new Map([[hash('a'), states[call++ % states.length]]])),
    );

    await expect(
      service.buildEquipment(`campaign:${campaignA}`, 'GER'),
    ).rejects.toThrow('Campaign data changed while trends were being built');
  });

  test('clearing the cache (process restart equivalent) rebuilds from persisted artifacts', async () => {
    add(
      item('a', '1936.1.1', '2026-01-01T00:00:00Z'),
      campaignA,
      equipmentResult('1936.1.1', [['one', 1]]),
    );
    await service.buildEquipment(`campaign:${campaignA}`, 'GER');
    expect(reads()).toBe(1);
    projections.clear();
    await service.buildEquipment(`campaign:${campaignA}`, 'GER');
    expect(reads()).toBe(2);
  });
});
