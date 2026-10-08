import { Logger } from '@nestjs/common';
import files from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Response } from 'express';
import type { SafeUserDto } from '../auth/auth.types';
import { AnalysisResultCacheService } from '../hoi4/analysis-result-cache.service';
import type { Hoi4AnalysisWorkerService } from '../hoi4/hoi4-analysis-worker.service';
import { AnalyzeController } from './analyze.controller';
import { BatchAnalysisController } from './batch-analysis.controller';
import type { AnalysisOwnershipService } from './analysis-ownership.service';
import { AnalysisComparisonService } from './analysis-comparison.service';
import { comparisonResult } from './fixtures/analysis-comparison.fixture';
import { MemoryOwnership } from './fixtures/memory-ownership.fixture';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import { RecentAnalysesService } from './recent-analyses.service';
import { UserAnalysesService } from './user-analyses.service';
import { SharedAnalysesService } from './shared-analyses.service';
import { SharedAnalysesController } from './shared-analyses.controller';
import { CampaignTrendsService } from './campaign-trends.service';
import { CampaignSnapshotProjectionCacheService } from './campaign-snapshot-projection-cache.service';
import { CampaignIntelligenceService } from './intelligence/campaign-intelligence.service';
import type { ProductEventsService } from '../telemetry/product-events.service';

const user: SafeUserDto = {
  id: 'isolated-owner',
  email: 'test@example.invalid',
  createdAt: '2026-01-01T00:00:00Z',
};
const campaignId = '00000000-0000-4000-8000-000000000001';
const context = { campaignId, playerCountryTag: 'GER', gameVersion: '1.19.2' };

describe('computed result versus durable owned persistence', () => {
  let directory: string;
  let memory: MemoryOwnership;
  let ownership: AnalysisOwnershipService;
  let results: PersistedAnalysisResultService;
  let recent: RecentAnalysesService;
  let users: UserAnalysesService;
  let shares: SharedAnalysesService;
  let controller: AnalyzeController;
  let cache: AnalysisResultCacheService;
  const computed = comparisonResult();
  const worker = {
    analyzeWithContext: jest.fn(() =>
      Promise.resolve({
        result: computed,
        comparisonContext: context,
      }),
    ),
  };
  const names = [
    'HOI4_RECENT_ANALYSES_FILE',
    'HOI4_ANALYSIS_RESULTS_DIR',
    'HOI4_SHARED_ANALYSES_FILE',
    'HOI4_ANALYSIS_RESULTS_MAX_BYTES',
  ];
  const previous = names.map((name) => process.env[name]);

  function services() {
    results = new PersistedAnalysisResultService(ownership);
    shares = new SharedAnalysesService(results);
    recent = new RecentAnalysesService(results, shares);
    users = new UserAnalysesService(ownership, recent, results, shares);
    controller = new AnalyzeController(
      cache,
      recent,
      new AnalysisComparisonService(results),
      ownership,
      users,
    );
  }

  beforeEach(async () => {
    directory = await files.mkdtemp(
      join(tmpdir(), 'hoi4-persistence-outcome-'),
    );
    process.env.HOI4_RECENT_ANALYSES_FILE = join(directory, 'recent.json');
    process.env.HOI4_ANALYSIS_RESULTS_DIR = join(directory, 'results');
    process.env.HOI4_SHARED_ANALYSES_FILE = join(directory, 'shares.json');
    delete process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES;
    memory = new MemoryOwnership();
    ownership = memory as unknown as AnalysisOwnershipService;
    worker.analyzeWithContext.mockClear();
    cache = new AnalysisResultCacheService(
      worker as unknown as Hoi4AnalysisWorkerService,
    );
    services();
    await recent.list();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await files.rm(directory, { recursive: true, force: true });
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  });

  async function analyze(name = 'fixture', mode?: string) {
    const path = join(directory, `${name}.hoi4`);
    if (!(await files.stat(path).catch(() => null)))
      await files.writeFile(
        path,
        `HOI4txt\ndate="1944.5.1.2"\ncountries={}\n#${name}`,
      );
    const headers = new Map<string, string>();
    const response = {
      destroyed: false,
      setHeader: (key: string, value: string) => headers.set(key, value),
    } as unknown as Response;
    const hash = (await cache.analyzeWithHash(path)).hash;
    const body = await controller.analyze(
      user,
      { path: '' },
      response,
      {
        path,
        originalname: `${name}.hoi4`,
        size: (await files.stat(path)).size,
      },
      mode,
    );
    return { body, headers, hash };
  }

  async function expectTemporary(name = 'fixture') {
    const response = await analyze(name);
    expect(response.body).toBe(computed); // Full computed result remains directly viewable.
    expect(response.headers.get('X-Analysis-Persistence')).toBe('temporary');
    expect(response.headers.has('X-Analysis-Hash')).toBe(false);
    expect(await memory.hasOwnership(user.id, response.hash)).toBe(false);
    expect(
      await new BatchAnalysisController(results, ownership).preflight(user, {
        hashes: [response.hash],
      }),
    ).toEqual({ knownHashes: [] });
    expect(await users.list(user.id)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hash: response.hash }),
      ]),
    );
    expect(
      await controller.openResult(user, response.hash).catch(() => null),
    ).toBeNull();
    await expect(
      controller.compare(user, response.hash, response.hash),
    ).rejects.toThrow('unavailable');
    const trends = new CampaignTrendsService(
      recent,
      results,
      new CampaignSnapshotProjectionCacheService(results),
    );
    expect((await trends.build(await users.list(user.id))).snapshotCount).toBe(
      0,
    );
    await expect(
      new CampaignIntelligenceService(trends, users).build(user.id, {
        campaignKey: `campaign:${campaignId}`,
        baseHash: response.hash,
        targetHash: response.hash,
        countryTag: 'GER',
      }),
    ).rejects.toThrow('unavailable');
    await expect(
      new SharedAnalysesController(
        shares,
        ownership,
        {} as ProductEventsService,
      ).create(user, response.hash),
    ).rejects.toThrow('unavailable');
    return response;
  }

  test('successful artifact, metadata and ownership commit produces saved outcome and reopening', async () => {
    const response = await analyze();
    expect(response.headers.get('X-Analysis-Persistence')).toBe('saved');
    expect(response.headers.get('X-Analysis-Hash')).toBe(response.hash);
    expect(response.body).toBe(computed);
    expect(await users.list(user.id)).toEqual([
      expect.objectContaining({
        hash: response.hash,
        hasPersistedResult: true,
      }),
    ]);
    expect(
      (await memory.listForUser(user.id))[0].historyMetadata,
    ).toBeDefined();
    await expect(controller.openResult(user, response.hash)).resolves.toEqual(
      computed,
    );
    await expect(users.list('another-user')).resolves.toEqual([]);
  });

  test('quota exhaustion preserves computation but creates no owned saved result', async () => {
    process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = '1';
    services();
    const response = await expectTemporary();
    expect(await results.exists(response.hash)).toBe(false);
  });

  test('artifact write failure preserves computation and cleanup, then retry uses cache', async () => {
    await files.writeFile(
      join(directory, 'fixture.hoi4'),
      'HOI4txt\ndate="1944.5.1.2"\ncountries={}\n#fixture',
    );
    const originalOpen = files.open;
    const open = jest
      .spyOn(files, 'open')
      .mockImplementation((path, flags, mode) =>
        String(path).startsWith(join(directory, 'results')) && flags === 'wx'
          ? Promise.reject(new Error('private disk path'))
          : originalOpen(path, flags, mode),
      );
    const response = await expectTemporary();
    expect(await results.exists(response.hash)).toBe(false);
    expect(await files.readdir(join(directory, 'results'))).toEqual([]);
    open.mockRestore();
    const retry = await analyze();
    expect(retry.headers.get('X-Analysis-Persistence')).toBe('saved');
    expect(retry.hash).toBe(response.hash);
    expect(worker.analyzeWithContext).toHaveBeenCalledTimes(1);
  });

  test('Recent metadata failure is temporary and does not assign ownership', async () => {
    const persist = jest
      .spyOn(recent as unknown as { persist: () => Promise<void> }, 'persist')
      .mockRejectedValue(new Error('metadata write unavailable'));
    const response = await expectTemporary();
    persist.mockRestore();
    expect((await analyze()).headers.get('X-Analysis-Hash')).toBe(
      response.hash,
    );
    expect(worker.analyzeWithContext).toHaveBeenCalledTimes(1);
  });

  test('ownership/history database failure is temporary; retry reuses the existing artifact without writing it again', async () => {
    const ensure = jest
      .spyOn(memory, 'ensureOwnership')
      .mockRejectedValueOnce(new Error('database unavailable'));
    const response = await expectTemporary();
    expect(await results.exists(response.hash)).toBe(true);
    const before = await results.fingerprint(response.hash);
    const open = jest.spyOn(files, 'open');
    const retry = await analyze();
    expect(retry.headers.get('X-Analysis-Persistence')).toBe('saved');
    expect(await results.fingerprint(response.hash)).toEqual(before);
    expect(
      open.mock.calls.filter(
        ([path, flags]) =>
          String(path).startsWith(join(directory, 'results')) && flags === 'wx',
      ),
    ).toEqual([]);
    expect(worker.analyzeWithContext).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledTimes(2);
  });

  test('missing final artifact fingerprint cannot produce a durable success', async () => {
    jest.spyOn(results, 'fingerprint').mockResolvedValueOnce(null);
    await expectTemporary();
  });

  test('a true storage return alone without the ownership commit is not saved', async () => {
    jest.spyOn(recent, 'record').mockResolvedValueOnce(true);
    await expectTemporary();
  });

  test('invalid history projection cannot be advertised as a durable owned success', async () => {
    jest
      .spyOn(results, 'fingerprint')
      .mockResolvedValueOnce({ bytes: -1, mtimeMs: 1, ctimeMs: 1 });
    await expectTemporary();
  });

  test('cached/persisted reuse stays saved without duplicate writes and survives service restart', async () => {
    const first = await analyze();
    const before = await results.fingerprint(first.hash);
    services();
    await recent.list();
    const open = jest.spyOn(files, 'open');
    const second = await analyze();
    expect(second.headers.get('X-Analysis-Persistence')).toBe('saved');
    expect(second.hash).toBe(first.hash);
    expect(await results.fingerprint(first.hash)).toEqual(before);
    expect(
      open.mock.calls.filter(
        ([path, flags]) =>
          String(path).startsWith(join(directory, 'results')) && flags === 'wx',
      ),
    ).toEqual([]);
    expect(worker.analyzeWithContext).toHaveBeenCalledTimes(1);
    expect(await users.list(user.id)).toHaveLength(1);
  });

  test("a failed new operation never removes another user's owned, pinned or shared artifact", async () => {
    const first = await analyze('protected');
    await users.setPinned(user.id, first.hash, true);
    const share = await shares.create(first.hash);
    jest
      .spyOn(memory, 'ensureOwnership')
      .mockRejectedValueOnce(new Error('database unavailable'));
    const failed = await analyze('new');
    expect(failed.headers.get('X-Analysis-Persistence')).toBe('temporary');
    expect(await users.list(user.id)).toEqual([
      expect.objectContaining({
        hash: first.hash,
        pinned: true,
        hasPersistedResult: true,
      }),
    ]);
    expect(await shares.getResult(share!.id)).toEqual(computed);
    expect(await users.list('another-user')).toEqual([]);
    expect(await memory.hasOwnership(user.id, failed.hash)).toBe(false);
  });

  test('batch still fails explicitly on ownership failure, then proceeds sequentially on retry', async () => {
    jest
      .spyOn(memory, 'ensureOwnership')
      .mockRejectedValueOnce(new Error('database unavailable'));
    await expect(analyze('batch', 'batch')).rejects.toMatchObject({
      code: 'PERSISTENCE_FAILED',
    });
    const first = await analyze('batch', 'batch');
    const second = await analyze('batch-next', 'batch');
    expect(first.body).toMatchObject({ hash: first.hash, campaignId });
    expect(second.body).toMatchObject({ hash: second.hash, campaignId });
    expect(await users.list(user.id)).toHaveLength(2);
    expect(worker.analyzeWithContext).toHaveBeenCalledTimes(2);
  });
});
