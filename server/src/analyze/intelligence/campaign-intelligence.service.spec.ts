import { NotFoundException } from '@nestjs/common';
import type { AnalyzeResult } from '../../hoi4/hoi4-parser';
import type { SaveComparisonContext } from '../../hoi4/save-comparison-context';
import {
  CampaignTrendsService,
  CampaignTrendsDataChangedError,
} from '../campaign-trends.service';
import { CampaignSnapshotProjectionCacheService } from '../campaign-snapshot-projection-cache.service';
import type {
  PersistedAnalysisResultService,
  PersistedResultFingerprint,
} from '../persisted-analysis-result.service';
import type {
  RecentAnalysesService,
  RecentAnalysis,
} from '../recent-analyses.service';
import type { UserAnalysesService } from '../user-analyses.service';
import {
  CampaignIntelligenceService,
  intelligenceDate,
} from './campaign-intelligence.service';
import {
  CAMPAIGN,
  VERSION,
  hash,
  intelligenceResult,
  query,
} from './intelligence.fixture';

describe('Campaign Intelligence authorized window / shared cache', () => {
  let entries: RecentAnalysis[];
  let artifacts: Map<
    string,
    { result: AnalyzeResult; comparisonContext: SaveComparisonContext }
  >;
  let inventory: Map<string, PersistedResultFingerprint>;
  let list: jest.Mock<Promise<RecentAnalysis[]>, [string]>;
  let reads: jest.Mock;
  let fingerprints: jest.Mock;
  let cache: CampaignSnapshotProjectionCacheService;
  let service: CampaignIntelligenceService;
  const fp = (mtimeMs = 1) => ({ bytes: 1000, mtimeMs, ctimeMs: 1 });
  function add(
    letter: string,
    gameDate: string,
    result = intelligenceResult(),
    context: SaveComparisonContext = {
      campaignId: CAMPAIGN,
      gameVersion: VERSION,
    },
  ) {
    const key = hash(letter);
    entries.push({
      hash: key,
      fileName: `${letter}.hoi4`,
      fileSizeBytes: 1000,
      analyzedAt: '2026-01-01T00:00:00Z',
      gameDate,
      countryCount: 1,
      divisionCount: 10,
      shipCount: 0,
      navalLossCount: 0,
      manpowerInField: 100,
      aircraftCount: 0,
      hasPersistedResult: true,
      pinned: false,
    });
    artifacts.set(key, {
      result: { ...result, game_date: gameDate },
      comparisonContext: context,
    });
    inventory.set(key, fp());
  }
  beforeEach(() => {
    entries = [];
    artifacts = new Map();
    inventory = new Map();
    list = jest.fn<Promise<RecentAnalysis[]>, [string]>(() =>
      Promise.resolve([...entries]),
    );
    reads = jest.fn((key: string) =>
      Promise.resolve(artifacts.get(key) ?? null),
    );
    fingerprints = jest.fn(() => Promise.resolve(new Map(inventory)));
    const results = {
      getWithContext: reads,
      fingerprintInventory: fingerprints,
    } as unknown as PersistedAnalysisResultService;
    cache = new CampaignSnapshotProjectionCacheService(results);
    service = new CampaignIntelligenceService(
      new CampaignTrendsService(
        { list: jest.fn() } as unknown as RecentAnalysesService,
        results,
        cache,
      ),
      { list } as unknown as UserAnalysesService,
    );
    add('a', '1941.1.1');
    add(
      'b',
      '1942.1.1',
      intelligenceResult({
        mil: 12,
        allocation: 4,
        balance: -71,
        stockpile: -10,
      }),
    );
  });

  test('uses only current-user membership and warm fingerprints without full-result rereads', async () => {
    const first = await service.build('owner', query);
    expect(list).toHaveBeenCalledWith('owner');
    expect(first.window.temporalEligible).toBe(true);
    expect(reads).toHaveBeenCalledTimes(2);
    expect(await service.build('owner', query)).toEqual(first);
    expect(reads).toHaveBeenCalledTimes(2);
  });
  test('foreign endpoint is not read or served even if warm in shared cache', async () => {
    await cache.ensure(hash('b'), fp());
    reads.mockClear();
    entries = entries.filter((row) => row.hash !== hash('b'));
    await expect(service.build('other-owner', query)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(reads).not.toHaveBeenCalledWith(hash('b'));
  });
  test('ownership lookup failure fails closed before accessing artifacts', async () => {
    list.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.build('owner', query)).rejects.toThrow(
      'database unavailable',
    );
    expect(reads).not.toHaveBeenCalled();
  });
  test('unknown persisted campaigns are not stitched using recent metadata or filename', async () => {
    artifacts.get(hash('a'))!.comparisonContext.campaignId = null;
    entries.forEach((row) => {
      row.campaignId = CAMPAIGN;
      row.fileName = 'same-campaign.hoi4';
    });
    await expect(service.build('owner', query)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.build('owner', { ...query, campaignKey: `unknown:${hash('a')}` }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  test('known wrong-campaign endpoint gets the same generic unavailable error', async () => {
    artifacts.get(hash('b'))!.comparisonContext.campaignId =
      '016a6f0b-47b4-4812-a626-73537dcc5c56';
    await expect(service.build('owner', query)).rejects.toThrow(
      'Campaign snapshots are unavailable',
    );
  });
  test.each([
    ['1941.1.1', 'same_date_chronology_unknown'],
    ['1940.1.1', 'reversed_temporal_window'],
    ['1942.2.30', 'invalid_game_date'],
    ['unknown', 'invalid_game_date'],
  ])(
    'suppresses temporal interpretation for %s without discarding raw comparisons',
    async (date, reason) => {
      artifacts.get(hash('b'))!.result.game_date = date;
      const data = await service.build('owner', query);
      expect(data.window.temporalEligible).toBe(false);
      expect(data.window.suppressionReasons).toContain(reason);
      expect(data.signals).toEqual([]);
      expect(data.insights).toEqual([]);
      expect(
        data.summaries.find(
          (row) => row.metric.id === 'industry.effectiveMilitaryFactories',
        ),
      ).toMatchObject({ startValue: 10, endValue: 12, delta: 2 });
    },
  );
  test('analysis timestamp is not used to infer same-day game chronology', async () => {
    artifacts.get(hash('b'))!.result.game_date = '1941.1.1';
    entries[1].analyzedAt = '2099-01-01T00:00:00Z';
    expect(
      (await service.build('owner', query)).window.suppressionReasons,
    ).toContain('same_date_chronology_unknown');
  });
  test('differing known versions at endpoints or within the selected window suppress signals', async () => {
    add('c', '1941.6.1', intelligenceResult(), {
      campaignId: CAMPAIGN,
      gameVersion: '1.19.3',
    });
    const data = await service.build('owner', query);
    expect(data.window.suppressionReasons).toContain('game_version_mismatch');
    expect(data.insights).toEqual([]);
    expect(data.window.snapshotHashes).toEqual([
      hash('a'),
      hash('c'),
      hash('b'),
    ]);
  });
  test('unknown version remains explicit and lowers confidence, not a fabricated same version', async () => {
    artifacts.get(hash('b'))!.comparisonContext.gameVersion = null;
    const data = await service.build('owner', query);
    expect(data.window.temporalEligible).toBe(true);
    expect(data.coverageIssues).toContainEqual({
      code: 'unknown_game_version',
      snapshotHash: hash('b'),
    });
    expect(
      data.insights.every((row) => row.confidence.level === 'medium'),
    ).toBe(true);
  });

  test('endpoint version mismatch suppresses all temporal signals', async () => {
    artifacts.get(hash('b'))!.comparisonContext.gameVersion = '1.19.3';
    const data = await service.build('owner', query);
    expect(data.window.suppressionReasons).toContain('game_version_mismatch');
    expect(data.signals).toEqual([]);
  });

  test('country-wide allocation uses the persisted total including unresolved lines', async () => {
    const target = artifacts.get(hash('b'))!.result;
    target.militaryProductionSummaries[0].activeFactories = 8;
    target.militaryProductionSummaries[0].definitions[0].activeFactories = 2;
    const data = await service.build('owner', query);
    expect(
      data.summaries.find(
        (row) =>
          row.metric.id === 'production.activeFactories' &&
          row.metric.equipmentDefinition === undefined,
      ),
    ).toMatchObject({ startValue: 2, endValue: 8, delta: 6 });
    expect(
      data.insights.some(
        (row) => row.catalogId === 'INDUSTRY_ALLOCATION_EXPANSION',
      ),
    ).toBe(true);
    expect(
      data.insights.some(
        (row) => row.catalogId === 'ALLOCATION_WITH_STOCKPILE_DECLINE',
      ),
    ).toBe(false);
  });
  test('intermediate membership is deterministic; duplicate-day order is not claimed as chronology', async () => {
    add('d', '1941.6.1');
    add('c', '1941.6.1');
    add('e', '1941.1.1');
    add('f', '1943.1.1', intelligenceResult(), {
      campaignId: CAMPAIGN,
      gameVersion: '1.19.3',
    });
    entries.reverse();
    const first = await service.build('owner', query);
    expect(first.window.snapshotHashes).toEqual([
      hash('a'),
      hash('c'),
      hash('d'),
      hash('b'),
    ]);
    expect(first.coverageIssues).toContainEqual({
      code: 'same_date_intermediate_order_unknown',
    });
    expect(first.window.temporalEligible).toBe(true);
    entries.reverse();
    expect(await service.build('owner', query)).toEqual(first);
  });
  test('deleted artifacts are pruned and never replaced with a synthetic observation', async () => {
    add('c', '1941.6.1');
    await service.build('owner', query);
    inventory.delete(hash('c'));
    expect((await service.build('owner', query)).window.snapshotHashes).toEqual(
      [hash('a'), hash('b')],
    );
    inventory.delete(hash('b'));
    await expect(service.build('owner', query)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  test('unreadable endpoint and metadata-only endpoint remain unavailable', async () => {
    artifacts.delete(hash('b'));
    await expect(service.build('owner', query)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    entries[0].hasPersistedResult = false;
    await expect(service.build('owner', query)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  test('changed fingerprint recomputes evidence instead of caching intelligence by UUID', async () => {
    const before = await service.build('owner', query);
    artifacts.get(hash('b'))!.result.by_country[0].effectiveMilitaryFactories =
      18;
    inventory.set(hash('b'), fp(2));
    const after = await service.build('owner', query);
    expect(
      after.summaries.find(
        (row) => row.metric.id === 'industry.effectiveMilitaryFactories',
      )!.endValue,
    ).toBe(18);
    expect(after.insights.map((row) => row.id)).not.toEqual(
      before.insights.map((row) => row.id),
    );
    expect(reads).toHaveBeenCalledTimes(3);
  });
  test('mutation retries with freshly authorized membership and no mixed response', async () => {
    fingerprints
      .mockImplementationOnce(() => Promise.resolve(new Map(inventory)))
      .mockImplementationOnce(() => {
        add('c', '1941.6.1');
        return Promise.resolve(new Map(inventory));
      });
    const data = await service.build('owner', query);
    expect(data.window.snapshotHashes).toEqual([
      hash('a'),
      hash('c'),
      hash('b'),
    ]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(reads).toHaveBeenCalledTimes(3);
  });
  test('ownership removed during inventory retry cannot leak a now-foreign endpoint', async () => {
    fingerprints
      .mockImplementationOnce(() => Promise.resolve(new Map(inventory)))
      .mockImplementationOnce(() => {
        inventory.set(hash('a'), fp(2));
        entries = entries.filter((row) => row.hash !== hash('a'));
        return Promise.resolve(new Map(inventory));
      });
    await expect(service.build('owner', query)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(list).toHaveBeenCalledTimes(2);
  });
  test('continuous mutation fails through the shared typed consistency error', async () => {
    let generation = 0;
    fingerprints.mockImplementation(() =>
      Promise.resolve(
        new Map([...inventory.keys()].map((key) => [key, fp(++generation)])),
      ),
    );
    await expect(service.build('owner', query)).rejects.toBeInstanceOf(
      CampaignTrendsDataChangedError,
    );
    expect(fingerprints).toHaveBeenCalledTimes(4);
  });
  test('Gregorian invalid dates are rejected without changing Trends parsing', () => {
    expect(intelligenceDate('1944.2.29')).toEqual([1944, 2, 29]);
    expect(intelligenceDate('1941.2.29')).toBeNull();
    expect(intelligenceDate('1941.4.31')).toBeNull();
    expect(intelligenceDate('1941.5.1.2')).toBeNull();
  });
});
