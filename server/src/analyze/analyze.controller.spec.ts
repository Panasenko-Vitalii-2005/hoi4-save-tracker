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
import type { CampaignTrendsDto } from './campaign-trends.types';

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
  const originalHistoryFile = process.env.HOI4_RECENT_ANALYSES_FILE;
  const originalResultsDir = process.env.HOI4_ANALYSIS_RESULTS_DIR;
  const originalResultsBytes = process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES;
  const originalRoot = process.env.HOI4_SAVES_DIR;
  const originalCacheLimit = process.env.HOI4_ANALYSIS_CACHE_ENTRIES;
  const originalWorkerLimit = process.env.HOI4_ANALYSIS_WORKERS;
  const localSaveRoot = mkdtempSync(join(tmpdir(), 'hoi4-local-analyze-'));

  beforeAll(async () => {
    process.env.HOI4_SAVES_DIR = localSaveRoot;
    process.env.HOI4_ANALYSIS_CACHE_ENTRIES = '3';
    process.env.HOI4_ANALYSIS_WORKERS = '1';
    process.env.HOI4_RECENT_ANALYSES_FILE = join(localSaveRoot, 'recent.json');
    process.env.HOI4_ANALYSIS_RESULTS_DIR = join(localSaveRoot, 'results');
    delete process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES;
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
        CampaignTrendsService,
        SaveUploadInterceptor,
      ],
    }).compile();
    analysis = moduleRef.get(Hoi4AnalysisWorkerService);
    cache = moduleRef.get(AnalysisResultCacheService);
    history = moduleRef.get(RecentAnalysesService);
    results = moduleRef.get(PersistedAnalysisResultService);
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await history.clear();
  });

  afterAll(async () => {
    await app.close();
    rmSync(localSaveRoot, { recursive: true, force: true });
    if (originalRoot === undefined) delete process.env.HOI4_SAVES_DIR;
    else process.env.HOI4_SAVES_DIR = originalRoot;
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

  test('pin/unpin/refresh/delete API preserves unrelated entries and evicts the deleted RAM result', async () => {
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
      .expect(200);
    expect(await results.exists(item.hash)).toBe(false);
    expect(cache['completed'].has(item.hash)).toBe(false);
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
    expect(analysis.created).toBe(workers + 1);
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

  test('unknown pin returns 404 while delete is idempotently successful', async () => {
    await request(app.getHttpServer())
      .patch(`/api/analyze/recent/${'0'.repeat(64)}`)
      .send({ pinned: true })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/analyze/recent/${'0'.repeat(64)}`)
      .expect(200, { items: [] });
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
      expect(readdirSync(UPLOAD_DIRECTORY).sort()).toEqual(before);
    } finally {
      hashFailure.mockRestore();
    }
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
