import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { AnalysisOwnershipService } from './analysis-ownership.service';
import { AnalysisComparisonService } from './analysis-comparison.service';
import { AnalyzeController } from './analyze.controller';
import type { AnalysisResultCacheService } from '../hoi4/analysis-result-cache.service';
import { comparisonResult } from './fixtures/analysis-comparison.fixture';
import { MemoryOwnership } from './fixtures/memory-ownership.fixture';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import { RecentAnalysesService } from './recent-analyses.service';
import { SharedAnalysesService } from './shared-analyses.service';
import { UserAnalysesService } from './user-analyses.service';
import { CampaignTrendsService } from './campaign-trends.service';
import { CampaignSnapshotProjectionCacheService } from './campaign-snapshot-projection-cache.service';
import { CampaignIntelligenceService } from './intelligence/campaign-intelligence.service';
import { historySummary } from './owned-analysis-history';

const digest = (text: string) =>
  createHash('sha256').update(text).digest('hex');
const campaign = (user: number) =>
  `00000000-0000-4000-8000-${String(user).padStart(12, '0')}`;
const snapshot = (user: number, index: number) => digest(`${user}:${index}`);

describe('durable owned history beyond global Recent turnover', () => {
  let directory: string;
  let memory: MemoryOwnership;
  let ownership: AnalysisOwnershipService;
  let results: PersistedAnalysisResultService;
  let recent: RecentAnalysesService;
  let users: UserAnalysesService;
  let shares: SharedAnalysesService;
  const envNames = [
    'HOI4_RECENT_ANALYSES_FILE',
    'HOI4_ANALYSIS_RESULTS_DIR',
    'HOI4_SHARED_ANALYSES_FILE',
    'HOI4_RECENT_ANALYSES_LIMIT',
  ];
  const previous = envNames.map((key) => process.env[key]);

  function restart() {
    results = new PersistedAnalysisResultService(ownership);
    shares = new SharedAnalysesService(results);
    recent = new RecentAnalysesService(results, shares);
    users = new UserAnalysesService(ownership, recent, results, shares);
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'hoi4-history-cohort-'));
    process.env.HOI4_RECENT_ANALYSES_FILE = join(directory, 'recent.json');
    process.env.HOI4_ANALYSIS_RESULTS_DIR = join(directory, 'results');
    process.env.HOI4_SHARED_ANALYSES_FILE = join(directory, 'shares.json');
    delete process.env.HOI4_RECENT_ANALYSES_LIMIT;
    memory = new MemoryOwnership();
    ownership = memory as unknown as AnalysisOwnershipService;
    restart();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    envNames.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  });

  async function record(user: number, index: number, legacy = false) {
    const hash = snapshot(user, index);
    const fileName = `private-${user}-${index}.hoi4`;
    await recent.record(
      { hash, fileName, fileSizeBytes: 1000 },
      comparisonResult({ game_date: `1944.1.${index + 1}` }),
      {
        campaignId: campaign(user),
        gameVersion: '1.19.2',
        playerCountryTag: 'GER',
      },
      async (item, fingerprint) => {
        expect(fingerprint).not.toBeNull();
        await memory.ensureOwnership(String(user), hash, {
          fileName,
          ...(!legacy
            ? {
                historyMetadata: {
                  version: 1,
                  summary: historySummary(item),
                  fingerprint: fingerprint!,
                },
              }
            : {}),
        });
      },
    );
  }

  test('20 users x 25 retained snapshots survive turnover/restart and remain usable in Trends, Compare and Intelligence', async () => {
    for (let user = 0; user < 20; user += 1)
      for (let index = 0; index < 25; index += 1)
        await record(user, index, user === 0);
    expect(await recent.list()).toHaveLength(200);
    expect(
      (await recent.list()).some((item) => item.hash === snapshot(0, 0)),
    ).toBe(false);
    let count = 0;
    for (let user = 0; user < 20; user += 1) {
      const items = await users.list(String(user));
      expect(items).toHaveLength(25);
      expect(
        items.every(
          (item) =>
            item.hasPersistedResult &&
            item.fileName.startsWith(`private-${user}-`),
        ),
      ).toBe(true);
      expect(new Set(items.map((item) => item.hash))).toEqual(
        new Set(Array.from({ length: 25 }, (_, i) => snapshot(user, i))),
      );
      count += items.length;
    }
    expect(count).toBe(500);
    await expect(users.setPinned('0', snapshot(0, 0), true)).resolves.toBe(
      true,
    );
    await expect(users.setPinned('1', snapshot(0, 0), true)).resolves.toBe(
      false,
    );
    const share = await shares.create(snapshot(0, 0));
    expect(share).not.toBeNull();
    expect((await users.list('0'))[0].fileSizeBytes).toBeNull(); // No exact size source survived for this legacy row.
    await writeFile(
      join(directory, 'recent.json'),
      JSON.stringify({ items: [] }),
    );
    restart();
    expect(await recent.list()).toHaveLength(0);
    const reads = jest.spyOn(results, 'getWithContext');
    for (let user = 0; user < 20; user += 1)
      expect(await users.list(String(user))).toHaveLength(25);
    expect(reads).not.toHaveBeenCalled(); // Compact PostgreSQL projection + fingerprint, not 500 decompressions.
    expect(
      (await users.list('0')).find((item) => item.hash === snapshot(0, 0))
        ?.pinned,
    ).toBe(true);
    await expect(shares.getResult(share!.id)).resolves.not.toBeNull();
    const cache = new CampaignSnapshotProjectionCacheService(results);
    const trends = new CampaignTrendsService(recent, results, cache);
    expect((await trends.build(await users.list('0'))).snapshotCount).toBe(25);
    const intelligence = new CampaignIntelligenceService(trends, users);
    const query = {
      campaignKey: `campaign:${campaign(0)}`,
      baseHash: snapshot(0, 0),
      targetHash: snapshot(0, 24),
      countryTag: 'GER',
    };
    expect(
      (await intelligence.build('0', query)).window.snapshotHashes,
    ).toHaveLength(25);
    await expect(intelligence.build('1', query)).rejects.toThrow('unavailable');
    const controller = new AnalyzeController(
      {} as AnalysisResultCacheService,
      recent,
      new AnalysisComparisonService(results),
      ownership,
      users,
    );
    const user = {
      id: '0',
      email: 'isolated@example.invalid',
      createdAt: '2026-01-01T00:00:00Z',
    };
    await expect(
      controller.compare(user, snapshot(0, 0), snapshot(0, 24)),
    ).resolves.not.toBeNull();
    await expect(
      controller.compare(user, snapshot(0, 0), snapshot(1, 24)),
    ).rejects.toThrow('unavailable');
    await expect(users.getResult('0', snapshot(1, 0))).resolves.toBeNull();
    await expect(users.delete('0', snapshot(0, 0))).resolves.toBe(true);
    restart();
    expect(await users.list('0')).toHaveLength(24);
    await expect(users.getResult('0', snapshot(0, 0))).resolves.toBeNull();
    // B3: removing private ownership revokes the global link first; A1 discovery
    // for every other retained owned snapshot remains unchanged.
    await expect(shares.getResult(share!.id)).resolves.toBeNull();
    await expect(users.getResult('0', snapshot(0, 1))).resolves.not.toBeNull();
    expect(await users.list('1')).toHaveLength(25);
  }, 180000);

  test('missing/corrupt retained artifacts stay unavailable and never enter campaign projections', async () => {
    await record(0, 0);
    await record(0, 1);
    await unlink(join(directory, 'results', `${snapshot(0, 0)}.json.gz`));
    await writeFile(
      join(directory, 'results', `${snapshot(0, 1)}.json.gz`),
      'corrupt',
    );
    restart();
    const items = await users.list('0');
    expect(items).toHaveLength(2);
    expect(items.every((item) => !item.hasPersistedResult)).toBe(true);
    expect(await users.getResult('0', snapshot(0, 1))).toBeNull();
    const trends = new CampaignTrendsService(
      recent,
      results,
      new CampaignSnapshotProjectionCacheService(results),
    );
    expect((await trends.build(items)).snapshotCount).toBe(0);
  });

  test('legacy v1 artifacts without Recent can be discovered without inventing campaign or exact file size', async () => {
    const hash = snapshot(0, 0);
    await record(1, 0); // Creates the isolated result directory.
    await writeFile(
      join(directory, 'results', `${hash}.json.gz`),
      gzipSync(
        JSON.stringify({
          formatVersion: 1,
          hash,
          savedAt: '2026-01-01T00:00:00Z',
          result: comparisonResult(),
        }),
      ),
    );
    memory.own('0', hash, 'legacy.hoi4');
    const [item] = await users.list('0');
    expect(item).toMatchObject({
      hash,
      hasPersistedResult: true,
      campaignId: null,
      fileSizeBytes: null,
    });
    memory.own('0', snapshot(0, 1), 'unavailable.hoi4');
    expect(await users.list('0')).toHaveLength(1); // No summary/artifact: don't invent a healthy row.
    expect((await users.storageStatus('0')).cleanupEligibleCount).toBe(2);
  });

  test('deletion during lazy hydration cannot resurrect ownership', async () => {
    await record(0, 0, true);
    jest
      .spyOn(memory, 'setHistoryMetadata')
      .mockImplementationOnce(async (user, hash) => {
        await memory.remove(user, [hash]);
        return false;
      });
    expect(await users.list('0')).toEqual([]);
    expect(await memory.hasOwnership('0', snapshot(0, 0))).toBe(false);
  });

  test('a readable envelope with malformed summary fields does not block other owned history or invent counts', async () => {
    await record(0, 0);
    await record(0, 1);
    const result = comparisonResult();
    await writeFile(
      join(directory, 'results', `${snapshot(0, 0)}.json.gz`),
      gzipSync(
        JSON.stringify({
          formatVersion: 2,
          hash: snapshot(0, 0),
          savedAt: '2026-01-01T00:00:00Z',
          comparisonContext: { campaignId: campaign(0), gameVersion: '1.19.2' },
          result: { ...result, totals: { ...result.totals, divisions: 'bad' } },
        }),
      ),
    );
    const items = await users.list('0');
    expect(items).toHaveLength(2);
    expect(
      items.find((item) => item.hash === snapshot(0, 0))?.hasPersistedResult,
    ).toBe(false);
    expect(
      items.find((item) => item.hash === snapshot(0, 1))?.hasPersistedResult,
    ).toBe(true);
  });

  test('a changed artifact fingerprint revalidates and refreshes the compact summary', async () => {
    await record(0, 0);
    expect((await users.list('0'))[0].gameDate).toBe('1944.1.1');
    await results.save(
      snapshot(0, 0),
      comparisonResult({ game_date: '1944.2.1' }),
      [],
      {
        comparisonContext: { campaignId: campaign(0), gameVersion: '1.19.2' },
      },
    );
    const reads = jest.spyOn(results, 'getWithContext');
    expect((await users.list('0'))[0]).toMatchObject({
      gameDate: '1944.2.1',
      hasPersistedResult: true,
    });
    expect(reads).toHaveBeenCalledTimes(1);
    await users.list('0');
    expect(reads).toHaveBeenCalledTimes(1);
  });
});
