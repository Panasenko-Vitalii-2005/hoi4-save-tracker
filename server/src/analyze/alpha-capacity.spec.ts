import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { SafeUserDto } from '../auth/auth.types';
import { AnalysisResultCacheService } from '../hoi4/analysis-result-cache.service';
import { Hoi4AnalysisWorkerService } from '../hoi4/hoi4-analysis-worker.service';
import { ProductEventsService } from '../telemetry/product-events.service';
import { AnalyzeController } from './analyze.controller';
import { AnalysisComparisonService } from './analysis-comparison.service';
import { AnalysisOwnershipService } from './analysis-ownership.service';
import { BatchAnalysisController } from './batch-analysis.controller';
import { CampaignTrendsService } from './campaign-trends.service';
import { CampaignSnapshotProjectionCacheService } from './campaign-snapshot-projection-cache.service';
import { comparisonResult } from './fixtures/analysis-comparison.fixture';
import { MemoryOwnership } from './fixtures/memory-ownership.fixture';
import { smallSave } from './fixtures/upload.fixture';
import { CampaignIntelligenceService } from './intelligence/campaign-intelligence.service';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import { RecentAnalysesService } from './recent-analyses.service';
import { SaveUploadInterceptor } from './save-upload.interceptor';
import { SharedAnalysesService } from './shared-analyses.service';
import { UserAnalysesService } from './user-analyses.service';

const scaledBudget = 2 * 1024 * 1024;
const campaign = (user: number) =>
  `00000000-0000-4000-8000-${String(user).padStart(12, '0')}`;
const userDto = (id: string): SafeUserDto => ({
  id,
  email: 'isolated@example.invalid',
  createdAt: '2026-01-01T00:00:00Z',
});

describe('bounded external-alpha capacity (synthetic uploads only)', () => {
  const keys = [
    'HOI4_UPLOAD_DIRECTORY',
    'HOI4_RECENT_ANALYSES_FILE',
    'HOI4_ANALYSIS_RESULTS_DIR',
    'HOI4_SHARED_ANALYSES_FILE',
    'HOI4_ANALYSIS_RESULTS_MAX_BYTES',
    'HOI4_RECENT_ANALYSES_LIMIT',
    'HOI4_ANALYSIS_REQUESTS',
    'HOI4_MAX_UPLOAD_BYTES',
    'HOI4_UPLOAD_TIMEOUT_MS',
    'HOI4_ANALYSIS_CACHE_ENTRIES',
  ];
  const previous = keys.map((key) => process.env[key]);
  let directory: string;
  let app: INestApplication<App>;
  let results: PersistedAnalysisResultService;
  let recent: RecentAnalysesService;
  let shares: SharedAnalysesService;
  let users: UserAnalysesService;
  let memory: MemoryOwnership;
  let cache: AnalysisResultCacheService;
  let boundary: SaveUploadInterceptor;
  const worker = {
    analyzeWithContext: jest.fn(async (path: string) => {
      // Computation is stubbed, but hashing, HTTP upload/admission/cleanup,
      // gzip publication, retention, history, authorization and outcomes are real.
      const text = await readFile(path, 'utf8');
      const [, user, index] = /#snapshot=(\d+):(\d+)/.exec(text)!;
      return {
        result: comparisonResult({
          game_date: `1944.1.${Number(index) + 1}`,
          world_equipment: { synthetic: Number(user) * 100 + Number(index) },
        }),
        comparisonContext: {
          campaignId: campaign(Number(user)),
          playerCountryTag: 'GER',
          gameVersion: '1.19.2',
        },
      };
    }),
  };

  async function initialize() {
    results = new PersistedAnalysisResultService(
      memory as unknown as AnalysisOwnershipService,
    );
    shares = new SharedAnalysesService(results);
    recent = new RecentAnalysesService(results, shares);
    users = new UserAnalysesService(
      memory as unknown as AnalysisOwnershipService,
      recent,
      results,
      shares,
    );
    const module = await Test.createTestingModule({
      controllers: [AnalyzeController],
      providers: [
        SaveUploadInterceptor,
        { provide: AnalysisResultCacheService, useValue: cache },
        { provide: RecentAnalysesService, useValue: recent },
        { provide: PersistedAnalysisResultService, useValue: results },
        { provide: AnalysisOwnershipService, useValue: memory },
        { provide: UserAnalysesService, useValue: users },
        {
          provide: AnalysisComparisonService,
          useValue: new AnalysisComparisonService(results),
        },
        {
          provide: ProductEventsService,
          useValue: {
            recordStarted: jest.fn().mockResolvedValue(true),
            recordCompleted: jest.fn().mockResolvedValue(true),
            recordFailed: jest.fn().mockResolvedValue(true),
            recordRejected: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    // Test-only authentication; public auth/CSRF has its own regression suites.
    app.use(
      (
        req: Request & { user?: SafeUserDto },
        _res: Response,
        next: NextFunction,
      ) => {
        req.user = userDto(String(req.headers['x-test-user']));
        next();
      },
    );
    await app.init();
    boundary = module.get(SaveUploadInterceptor);
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'hoi4-alpha-capacity-'));
    process.env.HOI4_UPLOAD_DIRECTORY = join(directory, 'uploads');
    process.env.HOI4_RECENT_ANALYSES_FILE = join(directory, 'recent.json');
    process.env.HOI4_SHARED_ANALYSES_FILE = join(directory, 'shares.json');
    process.env.HOI4_ANALYSIS_RESULTS_DIR = join(directory, 'results');
    process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = String(scaledBudget);
    process.env.HOI4_RECENT_ANALYSES_LIMIT = '200';
    process.env.HOI4_ANALYSIS_REQUESTS = '2';
    process.env.HOI4_MAX_UPLOAD_BYTES = '4096';
    process.env.HOI4_UPLOAD_TIMEOUT_MS = '1000';
    process.env.HOI4_ANALYSIS_CACHE_ENTRIES = '3';
    memory = new MemoryOwnership();
    worker.analyzeWithContext.mockClear();
    cache = new AnalysisResultCacheService(
      worker as unknown as Hoi4AnalysisWorkerService,
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    await initialize();
  });

  afterEach(async () => {
    await app?.close();
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  });

  const send = (user: number, index: number, batch = false) =>
    request(app.getHttpServer())
      .post(`/api/analyze${batch ? '?response=batch' : ''}`)
      .set('X-Test-User', String(user))
      .attach('file', Buffer.from(smallSave(`#snapshot=${user}:${index}`)), {
        filename: `private-${user}-${index}.hoi4`,
      });

  async function cleanUploadsAndArtifacts(count: number) {
    expect(await readdir(boundary.directory)).toEqual([]);
    const entries = await readdir(process.env.HOI4_ANALYSIS_RESULTS_DIR!).catch(
      (error: NodeJS.ErrnoException) => {
        if (count === 0 && error.code === 'ENOENT') return [];
        throw error;
      },
    );
    expect(entries).toHaveLength(count);
    expect(entries.every((name) => /^[a-f0-9]{64}\.json\.gz$/.test(name))).toBe(
      true,
    );
  }

  test('500 distinct owned snapshots survive turnover, exact quota rejection and non-destructive capacity recovery', async () => {
    for (let user = 0; user < 20; user++)
      for (let index = 0; index < 25; index++) {
        const response = await send(user, index, true).expect(201);
        const body = response.body as unknown as Record<string, unknown>;
        expect(body.hash).toMatch(/^[a-f0-9]{64}$/);
        expect(body.campaignId).toBe(campaign(user));
      }
    const withinBudget = await results.storageStatus();
    expect(withinBudget.maxBytes).toBe(scaledBudget);
    expect(withinBudget.totalBytes).toBeLessThan(scaledBudget);
    expect(withinBudget.files).toHaveLength(500);
    expect(await recent.list()).toHaveLength(200);
    expect(await users.list('outsider')).toEqual([]);
    for (let user = 0; user < 20; user++) {
      const items = await users.list(String(user));
      expect(items).toHaveLength(25);
      expect(
        items.every(
          (item) =>
            item.hasPersistedResult &&
            item.fileName.startsWith(`private-${user}-`),
        ),
      ).toBe(true);
    }
    const firstUser = await users.list('0');
    const firstHash = firstUser[0].hash;
    await users.setPinned('0', firstHash, true);
    const share = await shares.create(firstUser[1].hash);
    expect(share).not.toBeNull();

    // Reinitialize storage at exactly the measured protected bytes, not an
    // arbitrary tiny cap. Existing protected artifacts must all survive.
    process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = String(
      withinBudget.totalBytes,
    );
    await app.close();
    await initialize();
    expect(await recent.list()).toHaveLength(200);
    expect((await results.storageStatus()).files).toHaveLength(500);
    expect(await users.list('0')).toHaveLength(25);
    expect(
      (await users.list('0')).find((item) => item.hash === firstHash)?.pinned,
    ).toBe(true);
    const trends = new CampaignTrendsService(
      recent,
      results,
      new CampaignSnapshotProjectionCacheService(results),
    );
    expect((await trends.build(await users.list('0'))).snapshotCount).toBe(25);
    const query = {
      campaignKey: `campaign:${campaign(0)}`,
      baseHash: firstUser.find((item) => item.gameDate === '1944.1.1')!.hash,
      targetHash: firstUser.find((item) => item.gameDate === '1944.1.25')!.hash,
      countryTag: 'GER',
    };
    const intelligence = new CampaignIntelligenceService(trends, users);
    expect(
      (await intelligence.build('0', query)).window.snapshotHashes,
    ).toHaveLength(25);
    await expect(intelligence.build('1', query)).rejects.toThrow('unavailable');
    await expect(users.getResult('1', firstHash)).resolves.toBeNull();
    await request(app.getHttpServer())
      .get(
        `/api/analyze/compare?base=${firstUser.at(-1)!.hash}&target=${firstHash}`,
      )
      .set('X-Test-User', '0')
      .expect(200);

    const single = await send(0, 25).expect(201);
    expect(single.headers['x-analysis-persistence']).toBe('temporary');
    expect(single.headers['x-analysis-hash']).toBeUndefined();
    expect(single.body).toMatchObject({ game_date: '1944.1.26' }); // Computed result is visible.
    const batch = await send(0, 26, true).expect(503);
    expect(batch.body).toMatchObject({ code: 'PERSISTENCE_FAILED' });
    expect(await users.list('0')).toHaveLength(25);
    expect(await shares.getResult(share!.id)).not.toBeNull();
    expect((await results.storageStatus()).totalBytes).toBe(
      withinBudget.totalBytes,
    );
    await cleanUploadsAndArtifacts(500);

    // At full capacity a valid identical retained artifact is still reusable.
    const reuse = await send(19, 24).expect(201);
    expect(reuse.headers['x-analysis-persistence']).toBe('saved');
    expect((await results.storageStatus()).totalBytes).toBe(
      withinBudget.totalBytes,
    );
    expect(await users.list('19')).toHaveLength(25);

    // Raise only the synthetic byte cap. No cleanup/deletion of user history.
    process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = String(scaledBudget);
    await app.close();
    await initialize();
    const recovered = await send(0, 25).expect(201);
    expect(recovered.headers['x-analysis-persistence']).toBe('saved');
    expect(await users.list('0')).toHaveLength(26);
    expect(await users.list('1')).toHaveLength(25);
    const preflight = new BatchAnalysisController(
      results,
      memory as unknown as AnalysisOwnershipService,
    );
    expect(
      await preflight.preflight(userDto('0'), {
        hashes: [recovered.headers['x-analysis-hash']],
      }),
    ).toEqual({ knownHashes: [recovered.headers['x-analysis-hash']] });
    expect(
      await preflight.preflight(userDto('1'), {
        hashes: [recovered.headers['x-analysis-hash']],
      }),
    ).toEqual({ knownHashes: [] });
    await cleanUploadsAndArtifacts(501);
  }, 180_000);

  test('a quota-rejected current upload can reuse RAM computation when capacity becomes available', async () => {
    process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = '1';
    await app.close();
    await initialize();
    const temporary = await send(0, 0).expect(201);
    expect(temporary.headers['x-analysis-persistence']).toBe('temporary');
    expect(await users.list('0')).toEqual([]);
    await cleanUploadsAndArtifacts(0);
    process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = String(scaledBudget);
    await app.close();
    await initialize(); // Same process-local cache; a process restart need not reuse it.
    const recovered = await send(0, 0).expect(201);
    expect(recovered.headers['x-analysis-persistence']).toBe('saved');
    expect(worker.analyzeWithContext).toHaveBeenCalledTimes(1);
    await cleanUploadsAndArtifacts(1);
  });
});
