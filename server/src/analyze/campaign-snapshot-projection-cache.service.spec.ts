import { comparisonResult } from './fixtures/analysis-comparison.fixture';
import {
  CampaignSnapshotProjectionCacheService,
  projectSnapshot,
} from './campaign-snapshot-projection-cache.service';
import type { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import type { PersistedResultFingerprint } from './persisted-analysis-result.service';
import type { AnalyzeResult } from '../hoi4/hoi4-parser';
import type { SaveComparisonContext } from '../hoi4/save-comparison-context';

const hash = (letter: string) => letter.repeat(64);
const fp = (
  bytes = 1000,
  mtimeMs = 1,
  ctimeMs = 1,
): PersistedResultFingerprint => ({ bytes, mtimeMs, ctimeMs });
const context = (
  campaignId: string | null,
  playerCountryTag?: string | null,
): SaveComparisonContext => ({
  campaignId,
  gameVersion: '1.19.2',
  ...(playerCountryTag === undefined ? {} : { playerCountryTag }),
});

function equipmentResult(
  stockpile: Array<[string, number]> = [],
  production: Array<[string, number, number | null, boolean]> = [],
): AnalyzeResult {
  const result = comparisonResult();
  result.stockpileSummaries = [
    {
      countryTag: 'GER',
      definitions: stockpile.map(([definition, amount]) => ({
        definition,
        amount,
        variants: [],
      })),
      unresolvedVariants: [],
    },
  ];
  result.militaryProductionSummaries = [
    {
      countryTag: 'GER',
      lineCount: production.length,
      definitionCount: production.length,
      requestedFactories: 0,
      activeFactories: 0,
      queuedFactories: 0,
      damagedFactories: 0,
      resourceShortageLineCount: 0,
      definitions: production.map(
        ([
          equipmentDefinition,
          activeFactories,
          currentItemsPerDay,
          outputComplete,
        ]) => ({
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
        }),
      ),
      unresolvedLines: [],
    },
  ];
  return result;
}

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

describe('CampaignSnapshotProjectionCacheService', () => {
  const originalSnapshots = process.env.HOI4_TRENDS_CACHE_SNAPSHOTS;
  const originalBytes = process.env.HOI4_TRENDS_CACHE_BYTES;
  let artifacts: Map<
    string,
    { result: AnalyzeResult; comparisonContext: SaveComparisonContext }
  >;
  let calls: string[];
  let results: Pick<PersistedAnalysisResultService, 'getWithContext'>;
  let cache: CampaignSnapshotProjectionCacheService;

  beforeEach(() => {
    delete process.env.HOI4_TRENDS_CACHE_SNAPSHOTS;
    delete process.env.HOI4_TRENDS_CACHE_BYTES;
    artifacts = new Map();
    calls = [];
    results = {
      getWithContext: jest.fn((key: string) => {
        calls.push('getWithContext');
        return Promise.resolve(artifacts.get(key) ?? null);
      }),
    };
    cache = new CampaignSnapshotProjectionCacheService(
      results as unknown as PersistedAnalysisResultService,
    );
  });

  afterEach(() => {
    if (originalSnapshots === undefined)
      delete process.env.HOI4_TRENDS_CACHE_SNAPSHOTS;
    else process.env.HOI4_TRENDS_CACHE_SNAPSHOTS = originalSnapshots;
    if (originalBytes === undefined) delete process.env.HOI4_TRENDS_CACHE_BYTES;
    else process.env.HOI4_TRENDS_CACHE_BYTES = originalBytes;
  });

  const add = (
    letter: string,
    campaignId: string | null,
    result = comparisonResult(),
  ) => {
    artifacts.set(hash(letter), {
      result,
      comparisonContext: context(campaignId),
    });
  };

  test('loads a machine-readable projection once and reuses it while fingerprints match', async () => {
    add('a', null);
    const fingerprint = fp();
    const first = await cache.ensure(hash('a'), fingerprint);
    const second = await cache.ensure(hash('a'), fingerprint);
    expect((results.getWithContext as jest.Mock).mock.calls.length).toBe(1);
    expect(second).toEqual(first);
    expect(second?.fingerprint).toEqual(fingerprint);
    expect(cache.getValid(hash('a'), fingerprint)).toEqual(first);
  });

  test('never caches unreadable artifacts', async () => {
    const missing = await cache.ensure(hash('a'), fp());
    expect(missing).toBeNull();
    expect(cache.size).toBe(0);
    expect((results.getWithContext as jest.Mock).mock.calls.length).toBe(1);
  });

  test('a fingerprint change evicts the stale entry and reloads the artifact', async () => {
    add('a', null, equipmentResult([['one', 1]]));
    const oldFingerprint = fp(1000, 1, 1);
    await cache.ensure(hash('a'), oldFingerprint);
    expect(cache.getValid(hash('a'), oldFingerprint)).not.toBeNull();

    artifacts.set(hash('a'), {
      result: equipmentResult([['one', 5]]),
      comparisonContext: context(null),
    });
    const newFingerprint = fp(2000, 2, 2);
    const reloaded = await cache.ensure(hash('a'), newFingerprint);
    expect((results.getWithContext as jest.Mock).mock.calls.length).toBe(2);
    expect(
      reloaded?.equipmentCountries[0].definitions[0].stockpileBalance,
    ).toBe(5);
    expect(cache.getValid(hash('a'), oldFingerprint)).toBeNull();
  });

  test('concurrent same-hash callers share one persisted read', async () => {
    add('a', null, equipmentResult([['one', 1]]));
    const getWithContext = results.getWithContext as jest.Mock;
    const pending = deferred<{
      result: AnalyzeResult;
      comparisonContext: SaveComparisonContext;
    }>();
    getWithContext.mockReturnValueOnce(pending.promise);

    const first = cache.ensure(hash('a'), fp());
    const second = cache.ensure(hash('a'), fp());
    await waitFor(() => getWithContext.mock.calls.length === 1);
    pending.resolve(artifacts.get(hash('a'))!);

    const [a, b] = await Promise.all([first, second]);
    expect(getWithContext.mock.calls.length).toBe(1);
    expect(a).toEqual(b);
    expect(cache['inFlight'].size).toBe(0);
  });

  test('evicts the least recently used entry at the snapshot bound', async () => {
    process.env.HOI4_TRENDS_CACHE_SNAPSHOTS = '2';
    cache = new CampaignSnapshotProjectionCacheService(
      results as unknown as PersistedAnalysisResultService,
    );
    add('a', null);
    add('b', null);
    add('c', null);
    await cache.ensure(hash('a'), fp());
    await cache.ensure(hash('b'), fp());
    await cache.ensure(hash('c'), fp());
    expect(cache.size).toBe(2);
    expect(cache.getValid(hash('a'), fp())).toBeNull();
    expect(cache.getValid(hash('b'), fp())).not.toBeNull();
    expect(cache.getValid(hash('c'), fp())).not.toBeNull();
    expect(cache.getValid(hash('a'), fp())).toBeNull();
  });

  test('evicts oldest entries when the byte budget cannot hold them', async () => {
    add('a', null, equipmentResult([['one', 1]]));
    await cache.ensure(hash('a'), fp());
    const entryBytes = cache['entryEstimatedBytes'].get(hash('a'))!;
    expect(entryBytes).toBeGreaterThan(0);

    process.env.HOI4_TRENDS_CACHE_BYTES = String(entryBytes + 1);
    const bounded = new CampaignSnapshotProjectionCacheService(
      results as unknown as PersistedAnalysisResultService,
    );
    add('a', null, equipmentResult([['one', 1]]));
    add('b', null, equipmentResult([['two', 2]]));
    await bounded.ensure(hash('a'), fp());
    expect(bounded.size).toBe(1);
    await bounded.ensure(hash('b'), fp());
    expect(bounded.size).toBe(1);
    expect(bounded.getValid(hash('a'), fp())).toBeNull();
    expect(bounded.getValid(hash('b'), fp())).not.toBeNull();
  });

  test('a byte budget smaller than any entry retains nothing', async () => {
    process.env.HOI4_TRENDS_CACHE_BYTES = '1';
    cache = new CampaignSnapshotProjectionCacheService(
      results as unknown as PersistedAnalysisResultService,
    );
    add('a', null);
    await cache.ensure(hash('a'), fp());
    expect(cache.size).toBe(0);
  });

  test('invalid configuration falls back to documented defaults', () => {
    process.env.HOI4_TRENDS_CACHE_SNAPSHOTS = 'no';
    process.env.HOI4_TRENDS_CACHE_BYTES = '-1';
    cache = new CampaignSnapshotProjectionCacheService(
      results as unknown as PersistedAnalysisResultService,
    );
    expect(cache['snapshotLimit']).toBe(2048);
    expect(cache['byteLimit']).toBe(64 * 1024 * 1024);
  });

  test('pruneMissing removes projections whose artifacts no longer exist', async () => {
    add('a', null);
    add('b', null);
    await cache.ensure(hash('a'), fp());
    await cache.ensure(hash('b'), fp());
    expect(cache.size).toBe(2);
    cache.pruneMissing(new Set([hash('a')]));
    expect(cache.size).toBe(1);
    expect(cache.getValid(hash('b'), fp())).toBeNull();
  });

  test('projection keeps exact equipment semantics for every country', () => {
    const result = comparisonResult();
    result.stockpileSummaries = [
      {
        countryTag: 'GER',
        definitions: [
          { definition: 'infantry_equipment_1', amount: -1.25, variants: [] },
          { definition: 'infantry_equipment_1', amount: 0.5, variants: [] },
          { definition: 'support_equipment_1', amount: 0, variants: [] },
        ],
        unresolvedVariants: [],
      },
      {
        countryTag: 'USA',
        definitions: [
          { definition: 'modded__tank', amount: 2.25, variants: [] },
        ],
        unresolvedVariants: [],
      },
    ];
    result.militaryProductionSummaries = [
      {
        countryTag: 'GER',
        lineCount: 2,
        definitionCount: 2,
        requestedFactories: 0,
        activeFactories: 0,
        queuedFactories: 0,
        damagedFactories: 0,
        resourceShortageLineCount: 0,
        definitions: [
          {
            equipmentDefinition: 'infantry_equipment_1',
            lineCount: 1,
            requestedFactories: 4,
            activeFactories: 4,
            queuedFactories: 0,
            damagedFactories: 0,
            currentItemsPerDay: 9,
            knownCurrentItemsPerDay: 9,
            outputComplete: false,
            resourceShortageLineCount: 0,
            lines: [],
          },
          {
            equipmentDefinition: 'modded_new_design',
            lineCount: 1,
            requestedFactories: 2,
            activeFactories: 2,
            queuedFactories: 0,
            damagedFactories: 0,
            currentItemsPerDay: 0.5,
            knownCurrentItemsPerDay: 0.5,
            outputComplete: true,
            resourceShortageLineCount: 0,
            lines: [],
          },
        ],
        unresolvedLines: [],
      },
    ];

    const projection = projectSnapshot(
      hash('a'),
      result,
      context('0731c3c7-035e-46b1-b07b-6c35b27e8dc2', 'GER'),
      fp(),
    );
    expect(projection.campaignId).toBe('0731c3c7-035e-46b1-b07b-6c35b27e8dc2');
    expect(projection.playerCountryTag).toBe('GER');
    const gerDefinitions = projection.equipmentCountries.find(
      (entry) => entry.countryTag === 'GER',
    )!.definitions;
    const infantry = gerDefinitions.find(
      (entry) => entry.equipmentDefinition === 'infantry_equipment_1',
    )!;
    expect(infantry.stockpileBalance).toBe(-0.75);
    expect(infantry.activeFactories).toBe(4);
    expect(infantry.currentItemsPerDay).toBeNull();
    expect(infantry.productionRateComplete).toBe(false);
    const support = gerDefinitions.find(
      (entry) => entry.equipmentDefinition === 'support_equipment_1',
    )!;
    expect(support.stockpileBalance).toBe(0);
    const modded = gerDefinitions.find(
      (entry) => entry.equipmentDefinition === 'modded_new_design',
    )!;
    expect(modded.currentItemsPerDay).toBe(0.5);
    expect(modded.productionRateComplete).toBe(true);
    const usa = projection.equipmentCountries.find(
      (entry) => entry.countryTag === 'USA',
    )!;
    expect(usa.definitions[0]).toMatchObject({
      equipmentDefinition: 'modded__tank',
      stockpileBalance: 2.25,
    });
  });

  test('derives projections from persisted results only and never retains parser-heavy collections', async () => {
    add('a', null);
    const projection = await cache.ensure(hash('a'), fp());
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toMatch(
      /divisionSummaries|divisionTemplateCatalog|equipment_by_country|world_equipment|navalLosses|sourceOffset|warnings|lines|variants|equipmentRef/,
    );
    expect(calls).toEqual(['getWithContext']);
  });
});
