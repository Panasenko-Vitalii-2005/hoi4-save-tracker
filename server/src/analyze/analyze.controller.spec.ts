import {
  INestApplication,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import AdmZip from 'adm-zip';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AnalyzeController } from './analyze.controller';
import {
  Hoi4AnalysisWorkerService,
  type AnalyzedSave,
} from '../hoi4/hoi4-analysis-worker.service';
import { AnalysisResultCacheService } from '../hoi4/analysis-result-cache.service';
import { analyzeSave, type AnalyzeResult } from '../hoi4/hoi4-parser';
import { Worker } from 'node:worker_threads';
import { RecentAnalysesService } from './recent-analyses.service';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { AnalysisComparisonService } from './analysis-comparison.service';
import { SaveUploadInterceptor } from './save-upload.interceptor';
import { BatchAnalysisController } from './batch-analysis.controller';
import { CampaignTrendsController } from './campaign-trends.controller';
import { CampaignTrendsService } from './campaign-trends.service';
import { CampaignSnapshotProjectionCacheService } from './campaign-snapshot-projection-cache.service';
import type { CampaignTrendsDto } from './campaign-trends.types';
import type {
  AnalysisStorageMutationResult,
  AnalysisStorageStatus,
} from './analysis-storage.types';
import { AnalysisOwnershipService } from './analysis-ownership.service';
import type { SafeUserDto } from '../auth/auth.types';
import type { NextFunction, Request, Response } from 'express';
import { DatabaseUnavailableError } from '../database/database.service';
import { UserAnalysesService } from './user-analyses.service';
import { ProductEventsService } from '../telemetry/product-events.service';
import { SaveInputError } from '../hoi4/save-input.error';
import type {
  AnalysisAttemptContext,
  AnalysisCompletedProperties,
  AnalysisFailureProperties,
} from '../telemetry/product-events.types';

class TrackedWorkerService extends Hoi4AnalysisWorkerService {
  created = 0;

  protected createWorker(filePath: string): Worker {
    const worker = super.createWorker(filePath);
    this.created++;
    return worker;
  }
}

const MOWE = 'M\u00f6we';
const POTOSI = 'ARM Potos\u00ed';
const UPLOAD_DIRECTORY = join(tmpdir(), 'hoi4-save-tracker');
const UNKNOWN_CONTEXT = { campaignId: null, gameVersion: null } as const;
const FIRST_USER: SafeUserDto = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'first@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const SECOND_USER: SafeUserDto = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'second@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

interface AnalyzeResponse {
  game_date: string;
  navalLosses: Array<{ sunkShip: { name: string } }>;
  stockpileSummaries: unknown[];
  militaryProductionSummaries: unknown[];
  divisionSummaries: unknown[];
  divisionTemplateCatalog: unknown[];
  divisionEquipmentCatalog: unknown[];
  armyHierarchySummaries: unknown[];
}

function navalSave(shipName: string): string {
  return `HOI4txt
date="1944.5.1.2"
player="GER"
version="Operation Postern v1.19.2.0.a729 (d245)"
game_unique_id="0731c3c7-035e-46b1-b07b-6c35b27e8dc2"
history={
  sunk_ship={
    name="${shipName}"
    killer_name="HMS Example"
    country="GER"
    killer_country="ENG"
    definition="destroyer"
    killer_definition="destroyer"
    level=1
    equipment_variant={ id=1 type=70 }
    date="1941.1.19.24"
    location=1
    battle={ id=1 type=4713 }
    convoy=no
  }
}`;
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for uploads');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe('AnalyzeController uploads', () => {
  let app: INestApplication<App>;
  let analysis: TrackedWorkerService;
  let cache: AnalysisResultCacheService;
  let history: RecentAnalysesService;
  let results: PersistedAnalysisResultService;
  let ownership: {
    ensureOwnership: jest.Mock;
    ownedHashes: jest.Mock;
    listAllOwnedHashes: jest.Mock;
  };
  const telemetryCalls = {
    started: [] as AnalysisAttemptContext[],
    rejected: [] as Array<[AnalysisAttemptContext, AnalysisFailureProperties]>,
    completed: [] as Array<
      [AnalysisAttemptContext, AnalysisCompletedProperties]
    >,
    failed: [] as Array<[AnalysisAttemptContext, AnalysisFailureProperties]>,
  };
  const telemetry = {
    recordStarted: jest.fn((attempt: AnalysisAttemptContext) => {
      telemetryCalls.started.push(attempt);
      return Promise.resolve(true);
    }),
    recordRejected: jest.fn(
      (
        attempt: AnalysisAttemptContext,
        properties: AnalysisFailureProperties,
      ) => {
        telemetryCalls.rejected.push([attempt, properties]);
        return Promise.resolve(true);
      },
    ),
    recordCompleted: jest.fn(
      (
        attempt: AnalysisAttemptContext,
        properties: AnalysisCompletedProperties,
      ) => {
        telemetryCalls.completed.push([attempt, properties]);
        return Promise.resolve(true);
      },
    ),
    recordFailed: jest.fn(
      (
        attempt: AnalysisAttemptContext,
        properties: AnalysisFailureProperties,
      ) => {
        telemetryCalls.failed.push([attempt, properties]);
        return Promise.resolve(true);
      },
    ),
  } satisfies Pick<
    ProductEventsService,
    'recordStarted' | 'recordRejected' | 'recordCompleted' | 'recordFailed'
  >;
  let requestUser = FIRST_USER;
  const originalHistoryFile = process.env.HOI4_RECENT_ANALYSES_FILE;
  const originalResultsDir = process.env.HOI4_ANALYSIS_RESULTS_DIR;
  const originalResultsBytes = process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES;
  const originalRoot = process.env.HOI4_SAVES_DIR;
  const originalLocalSavesEnabled = process.env.HOI4_LOCAL_SAVES_ENABLED;
  const originalCacheLimit = process.env.HOI4_ANALYSIS_CACHE_ENTRIES;
  const originalWorkerLimit = process.env.HOI4_ANALYSIS_WORKERS;
  const localSaveRoot = mkdtempSync(join(tmpdir(), 'hoi4-local-analyze-'));

  beforeAll(async () => {
    process.env.HOI4_SAVES_DIR = localSaveRoot;
    process.env.HOI4_LOCAL_SAVES_ENABLED = 'true';
    process.env.HOI4_ANALYSIS_CACHE_ENTRIES = '3';
    process.env.HOI4_ANALYSIS_WORKERS = '1';
    process.env.HOI4_RECENT_ANALYSES_FILE = join(localSaveRoot, 'recent.json');
    process.env.HOI4_ANALYSIS_RESULTS_DIR = join(localSaveRoot, 'results');
    delete process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES;
    ownership = {
      ensureOwnership: jest.fn().mockResolvedValue(undefined),
      ownedHashes: jest.fn((_: string, hashes: readonly string[]) =>
        Promise.resolve(new Set(hashes)),
      ),
      listAllOwnedHashes: jest.fn().mockResolvedValue(new Set()),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [
        AnalyzeController,
        BatchAnalysisController,
        CampaignTrendsController,
      ],
      providers: [
        { provide: Hoi4AnalysisWorkerService, useClass: TrackedWorkerService },
        AnalysisResultCacheService,
        RecentAnalysesService,
        PersistedAnalysisResultService,
        AnalysisComparisonService,
        CampaignSnapshotProjectionCacheService,
        CampaignTrendsService,
        SaveUploadInterceptor,
        { provide: ProductEventsService, useValue: telemetry },
        { provide: AnalysisOwnershipService, useValue: ownership },
        {
          provide: UserAnalysesService,
          useFactory: (recent: RecentAnalysesService) => ({
            list: () => recent.list(),
            storageStatus: () => recent.storageStatus(),
            deleteUnpinned: () => recent.deleteUnpinned(),
            deleteCampaign: (
              _userId: string,
              campaignId: string,
              includePinned: boolean,
            ) => recent.deleteCampaign(campaignId, includePinned),
            clear: () => recent.clear(),
            getResult: (_userId: string, hash: string) =>
              recent.getResult(hash),
            delete: async (_userId: string, hash: string) => {
              const found = (await recent.list()).some(
                (item) => item.hash === hash,
              );
              if (found) await recent.delete(hash);
              return found;
            },
            setPinned: (_userId: string, hash: string, pinned: boolean) =>
              recent.setPinned(hash, pinned),
          }),
          inject: [RecentAnalysesService],
        },
      ],
    }).compile();
    analysis = moduleRef.get(Hoi4AnalysisWorkerService);
    cache = moduleRef.get(AnalysisResultCacheService);
    history = moduleRef.get(RecentAnalysesService);
    results = moduleRef.get(PersistedAnalysisResultService);
    app = moduleRef.createNestApplication();
    app.use(
      (
        request: Request & { user?: SafeUserDto },
        _response: Response,
        next: NextFunction,
      ) => {
        request.user = requestUser;
        next();
      },
    );
    await app.init();
  });

  beforeEach(async () => {
    process.env.HOI4_LOCAL_SAVES_ENABLED = 'true';
    requestUser = FIRST_USER;
    ownership.ensureOwnership.mockClear();
    ownership.listAllOwnedHashes.mockClear();
    Object.values(telemetry).forEach((method) => method.mockClear());
    telemetryCalls.started.length = 0;
    telemetryCalls.rejected.length = 0;
    telemetryCalls.completed.length = 0;
    telemetryCalls.failed.length = 0;
    await history.clear();
  });

  afterAll(async () => {
    await app.close();
    rmSync(localSaveRoot, { recursive: true, force: true });
    if (originalRoot === undefined) delete process.env.HOI4_SAVES_DIR;
    else process.env.HOI4_SAVES_DIR = originalRoot;
    if (originalLocalSavesEnabled === undefined)
      delete process.env.HOI4_LOCAL_SAVES_ENABLED;
    else process.env.HOI4_LOCAL_SAVES_ENABLED = originalLocalSavesEnabled;
    if (originalCacheLimit === undefined)
      delete process.env.HOI4_ANALYSIS_CACHE_ENTRIES;
    else process.env.HOI4_ANALYSIS_CACHE_ENTRIES = originalCacheLimit;
    if (originalWorkerLimit === undefined)
      delete process.env.HOI4_ANALYSIS_WORKERS;
    else process.env.HOI4_ANALYSIS_WORKERS = originalWorkerLimit;
    if (originalHistoryFile === undefined)
      delete process.env.HOI4_RECENT_ANALYSES_FILE;
    else process.env.HOI4_RECENT_ANALYSES_FILE = originalHistoryFile;
    if (originalResultsDir === undefined)
      delete process.env.HOI4_ANALYSIS_RESULTS_DIR;
    else process.env.HOI4_ANALYSIS_RESULTS_DIR = originalResultsDir;
    if (originalResultsBytes === undefined)
      delete process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES;
    else process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = originalResultsBytes;
  });

  test.each([
    ['plain', Buffer.from(navalSave(MOWE), 'utf8'), MOWE],
    [
      'compressed',
      (() => {
        const zip = new AdmZip();
        zip.addFile('gamestate', Buffer.from(navalSave(POTOSI), 'utf8'));
        return zip.toBuffer();
      })(),
      POTOSI,
    ],
  ])(
    'analyzes and removes a %s uploaded save',
    async (_kind, payload, name) => {
      const existingUploads = readdirSync(UPLOAD_DIRECTORY).sort();
      const before = analysis.created;
      const response = await request(app.getHttpServer())
        .post('/api/analyze')
        .attach('file', payload, 'fixture.hoi4')
        .expect(201);
      const body = response.body as AnalyzeResponse;
      expect(response.headers['x-analysis-hash']).toBe(
        createHash('sha256').update(payload).digest('hex'),
      );

      expect(body.game_date).toBe('1944.5.1');
      expect(body.navalLosses[0].sunkShip.name).toBe(name);
      expect(body.stockpileSummaries).toEqual([]);
      expect(body.militaryProductionSummaries).toEqual([]);
      expect(body.divisionSummaries).toEqual([]);
      expect(body.divisionTemplateCatalog).toEqual([]);
      expect(body.divisionEquipmentCatalog).toEqual([]);
      expect(body.armyHierarchySummaries).toEqual([]);
      expect(readdirSync(UPLOAD_DIRECTORY).sort()).toEqual(existingUploads);
      expect(analysis.created).toBe(before + 1);
      const firstItem = (await history.list())[0];
      expect(firstItem).toMatchObject({
        hash: createHash('sha256').update(payload).digest('hex'),
        fileName: 'fixture.hoi4',
        fileSizeBytes: payload.length,
        gameDate: '1944.5.1',
        navalLossCount: 1,
        hasPersistedResult: true,
      });
      expect(await results.get(firstItem.hash)).toEqual(response.body);
      expect(
        (await results.getWithContext(firstItem.hash))?.comparisonContext,
      ).toEqual({
        campaignId: '0731c3c7-035e-46b1-b07b-6c35b27e8dc2',
        gameVersion: 'Operation Postern v1.19.2.0.a729 (d245)',
        playerCountryTag: 'GER',
      });
      const cached = await request(app.getHttpServer())
        .post('/api/analyze')
        .attach('file', payload, 'renamed.hoi4')
        .expect(201);
      expect(cached.body).toEqual(response.body);
      expect(analysis.created).toBe(before + 1);
      expect(ownership.ensureOwnership).toHaveBeenCalledTimes(2);
      expect(ownership.ensureOwnership).toHaveBeenNthCalledWith(
        1,
        FIRST_USER.id,
        firstItem.hash,
        { fileName: 'fixture.hoi4' },
      );
      expect(ownership.ensureOwnership).toHaveBeenNthCalledWith(
        2,
        FIRST_USER.id,
        firstItem.hash,
        { fileName: 'renamed.hoi4' },
      );
      const reopened = await request(app.getHttpServer())
        .get(`/api/analyze/recent/${firstItem.hash.toUpperCase()}/result`)
        .expect(200);
      expect(reopened.body).toEqual(response.body);
      expect(analysis.created).toBe(before + 1);
      const recent = await request(app.getHttpServer())
        .get('/api/analyze/recent')
        .expect(200);
      expect(recent.body).toEqual({ items: await history.list() });
      const updated = await history.list();
      expect(updated).toHaveLength(1);
      expect(updated[0].fileName).toBe('renamed.hoi4');
      expect(Date.parse(updated[0].analyzedAt)).toBeGreaterThanOrEqual(
        Date.parse(firstItem.analyzedAt),
      );
      const stored = readFileSync(join(localSaveRoot, 'recent.json'), 'utf8');
      expect(stored).not.toContain(UPLOAD_DIRECTORY);
      expect(stored).not.toMatch(
        /parse_seconds|by_country|navalLosses|temporaryPath/,
      );
      expect(readdirSync(UPLOAD_DIRECTORY).sort()).toEqual(existingUploads);
    },
  );

  test('records one correlated start/completion pair with canonical metadata', async () => {
    const payload = Buffer.from(navalSave(MOWE), 'utf8');
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', payload, 'private-name.hoi4')
      .expect(201);

    expect(telemetry.recordStarted).toHaveBeenCalledTimes(1);
    expect(telemetry.recordCompleted).toHaveBeenCalledTimes(1);
    expect(telemetry.recordRejected).not.toHaveBeenCalled();
    expect(telemetry.recordFailed).not.toHaveBeenCalled();
    const started = telemetryCalls.started[0];
    const [completed, completedProperties] = telemetryCalls.completed[0];
    expect(completed).toBe(started);
    expect(completed).toMatchObject({
      userId: FIRST_USER.id,
      fileSizeBytes: payload.length,
      saveFormat: 'plain_text',
      analysis: {
        contentHash: createHash('sha256').update(payload).digest('hex'),
        fileSizeBytes: payload.length,
        divisionCount: 0,
        saveFormat: 'plain_text',
      },
    });
    expect(completed.flowId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(typeof completedProperties.totalDurationMs).toBe('number');
  });

  test('records a validation rejection without a duplicate terminal event', async () => {
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', Buffer.from('HOI4bin\0private'), 'binary.hoi4')
      .expect(422);

    expect(telemetry.recordStarted).toHaveBeenCalledTimes(1);
    expect(telemetry.recordRejected).toHaveBeenCalledTimes(1);
    expect(telemetry.recordFailed).not.toHaveBeenCalled();
    expect(telemetry.recordCompleted).not.toHaveBeenCalled();
    expect(telemetryCalls.rejected[0][0]).toBe(telemetryCalls.started[0]);
    expect(telemetryCalls.rejected[0][1]).toEqual({
      errorCode: 'UNSUPPORTED_BINARY_SAVE',
      failureStage: 'validation',
      fileSizeBytes: Buffer.byteLength('HOI4bin\0private'),
    });
  });

  test('records a processing failure without changing the safe HTTP error', async () => {
    jest
      .spyOn(cache, 'analyzeWithHash')
      .mockRejectedValueOnce(new SaveInputError('ANALYSIS_TIMEOUT'));
    const response = await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', Buffer.from(navalSave(MOWE)), 'fixture.hoi4')
      .expect(504);

    expect(response.body).toMatchObject({ code: 'ANALYSIS_TIMEOUT' });
    expect(telemetry.recordStarted).toHaveBeenCalledTimes(1);
    expect(telemetry.recordFailed).toHaveBeenCalledTimes(1);
    expect(telemetry.recordRejected).not.toHaveBeenCalled();
    expect(telemetry.recordCompleted).not.toHaveBeenCalled();
    expect(telemetryCalls.failed[0][1]).toMatchObject({
      errorCode: 'ANALYSIS_TIMEOUT',
      failureStage: 'analysis',
      saveFormat: 'plain_text',
    });
  });

  test('preserves the existing JSON path request', async () => {
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', Buffer.from(navalSave(MOWE)), 'fixture.hoi4')
      .expect(201);
    const before = analysis.created;
    const savePath = join(localSaveRoot, 'fixture.hoi4');
    writeFileSync(savePath, Buffer.from(navalSave(MOWE), 'utf8'));

    const response = await request(app.getHttpServer())
      .post('/api/analyze')
      .send({ path: savePath })
      .expect(201);
    const body = response.body as AnalyzeResponse;

    expect(body.navalLosses[0].sunkShip.name).toBe(MOWE);
    expect(body.stockpileSummaries).toEqual([]);
    expect(body.militaryProductionSummaries).toEqual([]);
    expect(body.divisionSummaries).toEqual([]);
    expect(body.divisionTemplateCatalog).toEqual([]);
    expect(body.divisionEquipmentCatalog).toEqual([]);
    expect(body.armyHierarchySummaries).toEqual([]);
    expect(existsSync(savePath)).toBe(true);
    expect(analysis.created).toBe(before); // Reuses the identical plain upload.
    const { parse_seconds, ...semantic } = response.body as AnalyzeResult;
    const { parse_seconds: directSeconds, ...direct } = analyzeSave(savePath);
    expect(Number.isFinite(parse_seconds)).toBe(true);
    expect(Number.isFinite(directSeconds)).toBe(true);
    expect(semantic).toEqual(direct);
  });

  test('assigns the same cached hash to each authenticated principal', async () => {
    const payload = Buffer.from(navalSave('Shared content'));
    const hash = createHash('sha256').update(payload).digest('hex');
    const before = analysis.created;

    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', payload, 'first.hoi4')
      .expect(201);
    requestUser = SECOND_USER;
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', payload, 'second.hoi4')
      .expect(201);

    expect(analysis.created).toBe(before + 1);
    expect(ownership.ensureOwnership.mock.calls).toEqual([
      [FIRST_USER.id, hash, { fileName: 'first.hoi4' }],
      [SECOND_USER.id, hash, { fileName: 'second.hoi4' }],
    ]);
  });

  test('blocks JSON paths but preserves multipart uploads when local saves are disabled', async () => {
    const savePath = join(localSaveRoot, 'disabled-path.hoi4');
    writeFileSync(savePath, Buffer.from(navalSave('Disabled path fixture')));
    process.env.HOI4_LOCAL_SAVES_ENABLED = 'false';
    const before = analysis.created;

    await request(app.getHttpServer())
      .post('/api/analyze')
      .send({ path: savePath })
      .expect(404);
    expect(analysis.created).toBe(before);

    const response = await request(app.getHttpServer())
      .post('/api/analyze')
      .attach(
        'file',
        Buffer.from(navalSave('Disabled mode upload')),
        'upload.hoi4',
      )
      .expect(201);
    expect((response.body as AnalyzeResponse).game_date).toBe('1944.5.1');
    expect(analysis.created).toBe(before + 1);
  });

  test('preflights persisted hashes without invoking the Worker or parser', async () => {
    const payload = Buffer.from(navalSave('Batch known fixture'));
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', payload, 'known.hoi4')
      .expect(201);
    const known = createHash('sha256').update(payload).digest('hex');
    const before = analysis.created;

    const response = await request(app.getHttpServer())
      .post('/api/analyze/batch/preflight')
      .send({ hashes: [known, 'f'.repeat(64), known.toUpperCase()] })
      .expect(201);

    expect(response.body).toEqual({ knownHashes: [known] });
    expect(analysis.created).toBe(before);
  });

  test('returns a compact persisted acknowledgement for batch uploads', async () => {
    const payload = Buffer.from(navalSave('Batch summary fixture'));
    const response = await request(app.getHttpServer())
      .post('/api/analyze?response=batch')
      .attach('file', payload, 'batch.hoi4')
      .expect(201);
    const hash = createHash('sha256').update(payload).digest('hex');

    expect(response.body).toEqual({
      hash,
      gameDate: '1944.5.1',
      campaignId: '0731c3c7-035e-46b1-b07b-6c35b27e8dc2',
    });
    expect((await history.list())[0]).toMatchObject({
      hash,
      fileName: 'batch.hoi4',
      hasPersistedResult: true,
    });
    expect(await results.exists(hash)).toBe(true);
  });

  test('persists each batch success immediately and lets Trends group mixed campaigns', async () => {
    const secondCampaign = '1731c3c7-035e-46b1-b07b-6c35b27e8dc2';
    await request(app.getHttpServer())
      .post('/api/analyze?response=batch')
      .attach('file', Buffer.from(navalSave('Campaign A')), 'a.hoi4')
      .expect(201);
    let trends = await request(app.getHttpServer())
      .get('/api/analyze/trends')
      .expect(200);
    expect((trends.body as CampaignTrendsDto).snapshotCount).toBe(1);

    await request(app.getHttpServer())
      .post('/api/analyze?response=batch')
      .attach(
        'file',
        Buffer.from(
          navalSave('Campaign B').replace(
            '0731c3c7-035e-46b1-b07b-6c35b27e8dc2',
            secondCampaign,
          ),
        ),
        'b.hoi4',
      )
      .expect(201);
    trends = await request(app.getHttpServer())
      .get('/api/analyze/trends')
      .expect(200);
    const trendBody = trends.body as CampaignTrendsDto;
    expect(trendBody).toMatchObject({ snapshotCount: 2 });
    expect(trendBody.campaigns.map((campaign) => campaign.campaignId)).toEqual([
      '0731c3c7-035e-46b1-b07b-6c35b27e8dc2',
      secondCampaign,
    ]);
  });

  test('rejects path traversal outside the configured save root', async () => {
    await request(app.getHttpServer())
      .post('/api/analyze')
      .send({ path: '../outside.hoi4' })
      .expect(400);
  });

  test('preserves 400/404 validation before starting an analysis', async () => {
    await request(app.getHttpServer())
      .post('/api/analyze')
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/analyze')
      .send({ path: 'missing.hoi4' })
      .expect(404);
  });

  test('removes a corrupt upload before launching a Worker', async () => {
    const existingUploads = readdirSync(UPLOAD_DIRECTORY).sort();
    const response = await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', Buffer.from('PKinvalid'), 'corrupt.hoi4')
      .expect(400);
    expect((response.body as { code: string }).code).toBe('CORRUPT_ARCHIVE');
    expect(await history.list()).toEqual([]);
    expect(readdirSync(UPLOAD_DIRECTORY).sort()).toEqual(existingUploads);
  });

  test('returns overload as 503 and cleans up the rejected upload', async () => {
    const existingUploads = readdirSync(UPLOAD_DIRECTORY).sort();
    const spy = jest
      .spyOn(analysis, 'analyzeWithContext')
      .mockRejectedValueOnce(
        new ServiceUnavailableException(
          'Save analysis capacity is full; please retry later',
        ),
      );
    try {
      await request(app.getHttpServer())
        .post('/api/analyze')
        .attach(
          'file',
          Buffer.from(navalSave('Overload fixture')),
          'fixture.hoi4',
        )
        .expect(503);
      expect(await history.list()).toEqual([]);
      expect(readdirSync(UPLOAD_DIRECTORY).sort()).toEqual(existingUploads);
    } finally {
      spy.mockRestore();
    }
  });

  test('retains the upload until analysis settles and removes it after a Worker crash', async () => {
    const existingUploads = readdirSync(UPLOAD_DIRECTORY).sort();
    let uploadedPath: string | undefined;
    let crash!: (error: Error) => void;
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const spy = jest
      .spyOn(analysis, 'analyzeWithContext')
      .mockImplementation((filePath) => {
        uploadedPath = filePath;
        started();
        return new Promise((_resolve, reject) => {
          crash = reject;
        });
      });
    try {
      const response = request(app.getHttpServer())
        .post('/api/analyze')
        .attach('file', Buffer.from(navalSave('Crash fixture')), 'fixture.hoi4')
        .then((value) => value);
      await running;
      expect(existsSync(uploadedPath!)).toBe(true);
      crash(new Error('Save analysis worker exited without a result (code 2)'));
      expect((await response).status).toBe(500);
      expect(await history.list()).toEqual([]);
      expect(existsSync(uploadedPath!)).toBe(false);
      expect(readdirSync(UPLOAD_DIRECTORY).sort()).toEqual(existingUploads);
    } finally {
      spy.mockRestore();
    }
  });

  test('rejects an absolute path outside the configured save root', async () => {
    const outsideDirectory = mkdtempSync(join(tmpdir(), 'hoi4-outside-'));
    const outsideSave = join(outsideDirectory, 'outside.hoi4');
    writeFileSync(outsideSave, Buffer.from(navalSave(MOWE), 'utf8'));

    try {
      await request(app.getHttpServer())
        .post('/api/analyze')
        .send({ path: outsideSave })
        .expect(400);
    } finally {
      rmSync(outsideDirectory, { recursive: true, force: true });
    }
  });

  test.each(['success', 'failure', 'disconnect'])(
    'same-hash uploads share analysis and clean up only their own files on %s',
    async (outcome) => {
      const existingUploads = readdirSync(UPLOAD_DIRECTORY).sort();
      const payload = Buffer.from(navalSave(`Shared ${outcome}`));
      const reference = join(localSaveRoot, `shared-${outcome}.hoi4`);
      writeFileSync(reference, payload);
      const result = analyzeSave(reference);
      let leaderPath: string | undefined;
      let finish!: (value: AnalyzedSave) => void;
      let fail!: (error: Error) => void;
      const pending = new Promise<AnalyzedSave>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      const execute = jest
        .spyOn(analysis, 'analyzeWithContext')
        .mockImplementation((path) => {
          leaderPath = path;
          return pending;
        });
      const lookups = jest.spyOn(cache['inFlight'], 'get');
      const records = jest.spyOn(history, 'record');
      try {
        const leaderClosed = new Promise<void>((resolve) => {
          (app.getHttpServer() as Server).once(
            'request',
            (_request, response) => {
              response.once('close', resolve);
            },
          );
        });
        const leader = request(app.getHttpServer())
          .post('/api/analyze')
          .attach('file', payload, 'first.hoi4');
        const firstResponse = new Promise<number>((resolve) => {
          leader.end((_error, response) => resolve(response?.status ?? 0));
        });
        await waitFor(() => leaderPath !== undefined);
        const secondResponse = request(app.getHttpServer())
          .post('/api/analyze')
          .attach('file', payload, 'second.hoi4')
          .then((value) => value);
        await waitFor(() => lookups.mock.calls.length === 2);
        const added = readdirSync(UPLOAD_DIRECTORY).filter(
          (name) => !existingUploads.includes(name),
        );
        expect(added).toHaveLength(2);
        expect(existsSync(leaderPath!)).toBe(true);
        expect(execute).toHaveBeenCalledTimes(1);
        if (outcome === 'disconnect') {
          leader.abort();
          // Let the server observe the socket close before delivering success.
          await leaderClosed;
          expect(existsSync(leaderPath!)).toBe(true);
        }
        if (outcome === 'failure') fail(new Error('Shared worker crash'));
        else finish({ result, comparisonContext: UNKNOWN_CONTEXT });

        const second = await secondResponse;
        expect(second.status).toBe(outcome === 'failure' ? 500 : 201);
        if (outcome !== 'failure') expect(second.body).toEqual(result);
        if (outcome !== 'disconnect')
          expect(await firstResponse).toBe(second.status);
        await waitFor(() =>
          added.every((name) => !existsSync(join(UPLOAD_DIRECTORY, name))),
        );
        expect(readdirSync(UPLOAD_DIRECTORY).sort()).toEqual(existingUploads);
        expect(cache['inFlight'].size).toBe(0);
        expect(records).toHaveBeenCalledTimes(
          outcome === 'failure' ? 0 : outcome === 'disconnect' ? 1 : 2,
        );
        if (outcome === 'disconnect')
          expect((await history.list())[0].fileName).toBe('second.hoi4');
      } finally {
        finish({ result, comparisonContext: UNKNOWN_CONTEXT });
        execute.mockRestore();
        lookups.mockRestore();
        records.mockRestore();
      }
    },
  );

  test('clear endpoint removes metadata and durable results; cache and local save survive', async () => {
    const savePath = join(localSaveRoot, 'clear.hoi4');
    writeFileSync(savePath, navalSave('Clear fixture'));
    await request(app.getHttpServer())
      .post('/api/analyze')
      .send({ path: savePath })
      .expect(201);
    const workers = analysis.created;
    await request(app.getHttpServer())
      .delete('/api/analyze/recent')
      .expect(200, { items: [] });
    expect(await history.list()).toEqual([]);
    expect(readdirSync(join(localSaveRoot, 'results'))).toEqual([]);
    expect(existsSync(savePath)).toBe(true);
    await request(app.getHttpServer())
      .post('/api/analyze')
      .send({ path: savePath })
      .expect(201);
    expect(analysis.created).toBe(workers);
    expect(await history.list()).toHaveLength(1);
  });

  test('storage endpoint reports compressed results and known campaign without Worker work', async () => {
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', Buffer.from(navalSave('Storage A')), 'a.hoi4')
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', Buffer.from(navalSave('Storage B')), 'b.hoi4')
      .expect(201);
    const before = analysis.created;

    const response = await request(app.getHttpServer())
      .get('/api/analyze/storage')
      .expect(200);
    const body = response.body as AnalysisStorageStatus;

    expect(body).toMatchObject({
      recentAnalysisCount: 2,
      persistedAnalysisCount: 2,
      maxPersistedResultBytes: 128 * 1024 * 1024,
      knownCampaignCount: 1,
      unknownCampaignAnalysisCount: 0,
      pinnedAnalysisCount: 0,
      cleanupEligibleCount: 2,
    });
    expect(body.persistedResultBytes).toBeGreaterThan(0);
    expect(body.campaigns[0]).toMatchObject({
      campaignId: '0731c3c7-035e-46b1-b07b-6c35b27e8dc2',
      analysisCount: 2,
    });
    expect(analysis.created).toBe(before);
  });

  test('campaign delete requires pinned acknowledgement without evicting shared cache entries', async () => {
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', Buffer.from(navalSave('Campaign A')), 'a.hoi4')
      .expect(201);
    const item = (await history.list())[0];
    await request(app.getHttpServer())
      .patch(`/api/analyze/recent/${item.hash}`)
      .send({ pinned: true })
      .expect(200);
    const route =
      '/api/analyze/storage/campaign/0731c3c7-035e-46b1-b07b-6c35b27e8dc2';

    const blocked = await request(app.getHttpServer())
      .delete(route)
      .send({ includePinned: false })
      .expect(409);
    expect(blocked.body).toMatchObject({
      code: 'PINNED_ANALYSES_INCLUDED',
      pinnedCount: 1,
    });
    expect(await history.list()).toHaveLength(1);

    const deleted = await request(app.getHttpServer())
      .delete(route)
      .send({ includePinned: true })
      .expect(200);
    expect(deleted.body).toMatchObject({ deletedCount: 1, items: [] });
    expect(cache['completed'].has(item.hash)).toBe(true);
  });

  test('unpinned cleanup protects pins and rejects unsafe campaign requests', async () => {
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', Buffer.from(navalSave('Cleanup pinned')), 'pinned.hoi4')
      .expect(201);
    const pinned = (await history.list())[0];
    await history.setPinned(pinned.hash, true);
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach(
        'file',
        Buffer.from(navalSave('Cleanup ordinary')),
        'ordinary.hoi4',
      )
      .expect(201);

    const cleaned = await request(app.getHttpServer())
      .delete('/api/analyze/storage/unpinned')
      .expect(200);
    const body = cleaned.body as AnalysisStorageMutationResult;
    expect(body.deletedCount).toBe(1);
    expect(body.items).toEqual([
      expect.objectContaining({ hash: pinned.hash, pinned: true }),
    ]);
    await request(app.getHttpServer())
      .delete('/api/analyze/storage/campaign/not-a-campaign')
      .send({ includePinned: true })
      .expect(400);
    await request(app.getHttpServer())
      .delete(
        '/api/analyze/storage/campaign/0731c3c7-035e-46b1-b07b-6c35b27e8dc2',
      )
      .send({ includePinned: 'true' })
      .expect(400);
  });

  test('result persistence failure leaves successful POST and metadata with unavailable result', async () => {
    const save = jest.spyOn(results, 'save').mockResolvedValueOnce(false);
    try {
      const response = await request(app.getHttpServer())
        .post('/api/analyze')
        .attach(
          'file',
          Buffer.from(navalSave('Result write failure')),
          'failure.hoi4',
        )
        .expect(201);
      expect((response.body as AnalyzeResponse).game_date).toBe('1944.5.1');
      const item = (await history.list())[0];
      expect(item.hasPersistedResult).toBe(false);
      expect(ownership.ensureOwnership).not.toHaveBeenCalled();
      await request(app.getHttpServer())
        .get(`/api/analyze/recent/${item.hash}/result`)
        .expect(404);
    } finally {
      save.mockRestore();
    }
  });

  test('batch upload reports persistence failure safely and still cleans its temp file', async () => {
    const existingUploads = readdirSync(UPLOAD_DIRECTORY).sort();
    const payload = Buffer.from(navalSave('Batch result write failure'));
    const before = analysis.created;
    const save = jest.spyOn(results, 'save').mockResolvedValueOnce(false);
    try {
      const response = await request(app.getHttpServer())
        .post('/api/analyze?response=batch')
        .attach('file', payload, 'failure.hoi4')
        .expect(503);
      expect(ownership.ensureOwnership).not.toHaveBeenCalled();
      expect(response.body).toMatchObject({ code: 'PERSISTENCE_FAILED' });
      expect(JSON.stringify(response.body)).not.toMatch(
        /hoi4-save-tracker|stack|temporaryPath/i,
      );
      expect(readdirSync(UPLOAD_DIRECTORY).sort()).toEqual(existingUploads);
      await request(app.getHttpServer())
        .post('/api/analyze?response=batch')
        .attach('file', payload, 'failure-retry.hoi4')
        .expect(201);
      expect(analysis.created).toBe(before + 1); // Retry reuses the RAM result.
      expect((await history.list())[0]).toMatchObject({
        fileName: 'failure-retry.hoi4',
        hasPersistedResult: true,
      });
    } finally {
      save.mockRestore();
    }
  });

  test.each(['missing', 'corrupt'])(
    'reopen of a %s result is safe, updates availability and never starts Worker',
    async (kind) => {
      await request(app.getHttpServer())
        .post('/api/analyze')
        .attach(
          'file',
          Buffer.from(navalSave(`Unavailable ${kind}`)),
          'fixture.hoi4',
        )
        .expect(201);
      const item = (await history.list())[0];
      if (kind === 'missing') await results.delete(item.hash);
      else
        writeFileSync(
          join(localSaveRoot, 'results', `${item.hash}.json.gz`),
          'not gzip',
        );
      const before = analysis.created;
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      try {
        const response = await request(app.getHttpServer())
          .get(`/api/analyze/recent/${item.hash}/result`)
          .expect(404);
        expect((response.body as { message: string }).message).toBe(
          'Saved analysis result is unavailable',
        );
        expect((await history.list())[0].hasPersistedResult).toBe(false);
        expect(analysis.created).toBe(before);
      } finally {
        warn.mockRestore();
      }
    },
  );

  test.each([
    'invalid',
    'a'.repeat(63),
    'g'.repeat(64),
    '..%2F..%2Fsecret',
    '..%5C..%5Csecret',
  ])('rejects unsafe result hash %s before storage access', async (hash) => {
    const get = jest.spyOn(results, 'get');
    try {
      await request(app.getHttpServer())
        .get(`/api/analyze/recent/${hash}/result`)
        .expect(400);
      expect(get).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
    }
  });

  test('unknown valid hash returns unavailable without Worker execution', async () => {
    const before = analysis.created;
    await request(app.getHttpServer())
      .get(`/api/analyze/recent/${'0'.repeat(64)}/result`)
      .expect(404);
    expect(analysis.created).toBe(before);
  });

  test('pin/unpin/refresh/delete API preserves unrelated entries and shared RAM results', async () => {
    const savePath = join(localSaveRoot, 'managed.hoi4');
    writeFileSync(savePath, navalSave('Managed fixture'));
    const original = await request(app.getHttpServer())
      .post('/api/analyze')
      .send({ path: savePath })
      .expect(201);
    const item = (await history.list())[0];
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', Buffer.from(navalSave('Keep fixture')), 'keep.hoi4')
      .expect(201);
    const other = (await history.list())[0];
    await request(app.getHttpServer())
      .patch(`/api/analyze/recent/${item.hash.toUpperCase()}`)
      .send({ pinned: true })
      .expect(200);
    expect((await history.list())[0]).toEqual({ ...item, pinned: true });
    await request(app.getHttpServer())
      .patch(`/api/analyze/recent/${item.hash}`)
      .send({ pinned: false })
      .expect(200);
    expect(
      (await history.list()).find((i) => i.hash === item.hash)?.pinned,
    ).toBe(false);
    await request(app.getHttpServer())
      .patch(`/api/analyze/recent/${item.hash}`)
      .send({ pinned: true })
      .expect(200);
    const workers = analysis.created;
    await request(app.getHttpServer())
      .post('/api/analyze')
      .send({ path: savePath })
      .expect(201);
    expect((await history.list())[0].pinned).toBe(true);
    expect(analysis.created).toBe(workers);
    const reopened = await request(app.getHttpServer())
      .get(`/api/analyze/recent/${item.hash}/result`)
      .expect(200);
    expect(reopened.body).toEqual(original.body);
    await request(app.getHttpServer())
      .delete(`/api/analyze/recent/${item.hash.toUpperCase()}`)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/analyze/recent/${item.hash}`)
      .expect(404);
    expect(await results.exists(item.hash)).toBe(false);
    expect(cache['completed'].has(item.hash)).toBe(true);
    expect(cache['completed'].has(other.hash)).toBe(true);
    expect(await history.list()).toEqual([other]);
    expect(existsSync(savePath)).toBe(true);
    await request(app.getHttpServer())
      .get(`/api/analyze/recent/${item.hash}/result`)
      .expect(404);
    await request(app.getHttpServer())
      .post('/api/analyze')
      .send({ path: savePath })
      .expect(201);
    expect(analysis.created).toBe(workers);
  });

  test.each([
    'invalid',
    '..%2F..%2Fsecret',
    '..%5C..%5Csecret',
    'f'.repeat(63),
  ])('both management endpoints reject unsafe hash %s', async (hash) => {
    await request(app.getHttpServer())
      .delete(`/api/analyze/recent/${hash}`)
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/analyze/recent/${hash}`)
      .send({ pinned: true })
      .expect(400);
  });

  test.each([
    {},
    { pinned: 'true' },
    { pinned: 1 },
    { pinned: null },
    { pinned: true, fileName: 'renamed' },
    [{ pinned: true }],
  ])('pin endpoint rejects non-narrow body %j', async (body) => {
    await request(app.getHttpServer())
      .patch(`/api/analyze/recent/${'0'.repeat(64)}`)
      .send(body)
      .expect(400);
  });

  test('unknown private mutations return the same non-disclosing 404', async () => {
    await request(app.getHttpServer())
      .patch(`/api/analyze/recent/${'0'.repeat(64)}`)
      .send({ pinned: true })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/analyze/recent/${'0'.repeat(64)}`)
      .expect(404);
  });

  test('management write errors stay generic and preserve history', async () => {
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach(
        'file',
        Buffer.from(navalSave('Management errors')),
        'fixture.hoi4',
      )
      .expect(201);
    const item = (await history.list())[0];
    const pin = jest
      .spyOn(history, 'setPinned')
      .mockRejectedValueOnce(new Error('C:/private/storage'));
    const remove = jest
      .spyOn(history, 'delete')
      .mockRejectedValueOnce(new Error('C:/private/storage'));
    try {
      const pinned = await request(app.getHttpServer())
        .patch(`/api/analyze/recent/${item.hash}`)
        .send({ pinned: true })
        .expect(503);
      const deleted = await request(app.getHttpServer())
        .delete(`/api/analyze/recent/${item.hash}`)
        .expect(503);
      expect(JSON.stringify([pinned.body, deleted.body])).not.toContain(
        'private',
      );
      expect(await history.list()).toEqual([item]);
    } finally {
      pin.mockRestore();
      remove.mockRestore();
    }
  });

  test('clear explicitly removes pinned and unpinned entries and results', async () => {
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', Buffer.from(navalSave('Clear pinned')), 'pinned.hoi4')
      .expect(201);
    await history.setPinned((await history.list())[0].hash, true);
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', Buffer.from(navalSave('Clear unpinned')), 'unpinned.hoi4')
      .expect(201);
    expect(await history.list()).toHaveLength(2);
    await request(app.getHttpServer())
      .delete('/api/analyze/recent')
      .expect(200, { items: [] });
    expect(readdirSync(join(localSaveRoot, 'results'))).toEqual([]);
  });

  test('hash failure creates no history and still cleans the upload', async () => {
    const before = readdirSync(UPLOAD_DIRECTORY).sort();
    const hashFailure = jest
      .spyOn(cache, 'analyzeWithHash')
      .mockRejectedValueOnce(new Error('Cannot read upload'));
    try {
      await request(app.getHttpServer())
        .post('/api/analyze')
        .attach('file', Buffer.from(navalSave('Hash failure')), 'failure.hoi4')
        .expect(500);
      expect(await history.list()).toEqual([]);
      expect(ownership.ensureOwnership).not.toHaveBeenCalled();
      expect(readdirSync(UPLOAD_DIRECTORY).sort()).toEqual(before);
    } finally {
      hashFailure.mockRestore();
    }
  });

  test('ownership metadata failure fails closed with a safe response', async () => {
    ownership.ensureOwnership.mockRejectedValueOnce(
      new DatabaseUnavailableError(),
    );

    const response = await request(app.getHttpServer())
      .post('/api/analyze')
      .attach(
        'file',
        Buffer.from(navalSave('Ownership unavailable')),
        'ownership.hoi4',
      )
      .expect(503);

    expect(ownership.ensureOwnership).toHaveBeenCalledTimes(1);
    expect(response.body).toMatchObject({ code: 'ANALYZER_BUSY' });
    expect(JSON.stringify(response.body)).not.toMatch(
      /postgres|database|session|password|token|stack/i,
    );
  });

  test('history storage failure does not fail successful analysis or expose storage errors', async () => {
    const write = jest
      .spyOn(history as unknown as { persist: () => Promise<void> }, 'persist')
      .mockRejectedValue(new Error('private storage path'));
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    try {
      const response = await request(app.getHttpServer())
        .post('/api/analyze')
        .attach(
          'file',
          Buffer.from(navalSave('Storage failure')),
          'storage.hoi4',
        )
        .expect(201);
      expect((response.body as AnalyzeResponse).game_date).toBe('1944.5.1');
      expect(JSON.stringify(response.body)).not.toContain(
        'private storage path',
      );
      expect(await history.list()).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      write.mockRestore();
      warn.mockRestore();
    }
  });
});
