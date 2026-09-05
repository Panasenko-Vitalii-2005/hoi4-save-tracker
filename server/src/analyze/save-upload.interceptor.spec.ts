import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  utimesSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  request as httpRequest,
  type ClientRequest,
  type Server,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { Worker } from 'node:worker_threads';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AnalyzeController } from './analyze.controller';
import { SaveUploadInterceptor } from './save-upload.interceptor';
import { Hoi4AnalysisWorkerService } from '../hoi4/hoi4-analysis-worker.service';
import { AnalysisResultCacheService } from '../hoi4/analysis-result-cache.service';
import { RecentAnalysesService } from './recent-analyses.service';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import { AnalysisComparisonService } from './analysis-comparison.service';
import { smallSave, zipSave, forgedZipSize } from './fixtures/upload.fixture';
import { UPLOAD_STALE_MS } from '../hoi4/save-upload.policy';
import { AnalysisOwnershipService } from './analysis-ownership.service';
import type { SafeUserDto } from '../auth/auth.types';
import type { NextFunction, Request, Response } from 'express';

const USER: SafeUserDto = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'upload@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

class TestWorker extends Hoi4AnalysisWorkerService {
  created: Worker[] = [];
  script: string | null = null;
  protected createWorker(path: string) {
    const worker =
      this.script === null
        ? super.createWorker(path)
        : new Worker(this.script, { eval: true, execArgv: [] });
    this.created.push(worker);
    return worker;
  }
}

async function until(check: () => boolean) {
  const end = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > end) throw new Error('Test state did not settle');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('Public upload boundary and cleanup', () => {
  const keys = [
    'HOI4_UPLOAD_DIRECTORY',
    'HOI4_RECENT_ANALYSES_FILE',
    'HOI4_ANALYSIS_RESULTS_DIR',
    'HOI4_MAX_UPLOAD_BYTES',
    'HOI4_MAX_UNCOMPRESSED_BYTES',
    'HOI4_ANALYSIS_TIMEOUT_MS',
    'HOI4_UPLOAD_TIMEOUT_MS',
    'HOI4_ANALYSIS_REQUESTS',
    'HOI4_SAVES_DIR',
  ];
  const prior = keys.map((key) => process.env[key]);
  let directory: string;
  let app: INestApplication<App>;
  let boundary: SaveUploadInterceptor;
  let worker: TestWorker;
  let cache: AnalysisResultCacheService;
  let history: RecentAnalysesService;
  let results: PersistedAnalysisResultService;
  let warning: jest.SpyInstance;
  let port: number;
  let closed: boolean;
  const openRequests: ClientRequest[] = [];
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'hoi4-boundary-test-'));
    process.env.HOI4_UPLOAD_DIRECTORY = join(directory, 'uploads');
    process.env.HOI4_RECENT_ANALYSES_FILE = join(directory, 'recent.json');
    process.env.HOI4_ANALYSIS_RESULTS_DIR = join(directory, 'results');
    process.env.HOI4_SAVES_DIR = directory;
    process.env.HOI4_MAX_UPLOAD_BYTES = '4096';
    process.env.HOI4_MAX_UNCOMPRESSED_BYTES = '8192';
    process.env.HOI4_ANALYSIS_TIMEOUT_MS = '3000';
    process.env.HOI4_UPLOAD_TIMEOUT_MS = '1000';
    process.env.HOI4_ANALYSIS_REQUESTS = '2';
    warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const module = await Test.createTestingModule({
      controllers: [AnalyzeController],
      providers: [
        SaveUploadInterceptor,
        { provide: Hoi4AnalysisWorkerService, useClass: TestWorker },
        AnalysisResultCacheService,
        RecentAnalysesService,
        PersistedAnalysisResultService,
        AnalysisComparisonService,
        {
          provide: AnalysisOwnershipService,
          useValue: { ensureOwnership: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();
    boundary = module.get(SaveUploadInterceptor);
    worker = module.get(Hoi4AnalysisWorkerService);
    cache = module.get(AnalysisResultCacheService);
    history = module.get(RecentAnalysesService);
    results = module.get(PersistedAnalysisResultService);
    app = module.createNestApplication();
    app.use(
      (
        request: Request & { user?: SafeUserDto },
        _response: Response,
        next: NextFunction,
      ) => {
        request.user = USER;
        next();
      },
    );
    await app.listen(0, '127.0.0.1');
    closed = false;
    const server = app.getHttpServer() as Server;
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    for (const req of openRequests.splice(0)) req.destroy();
    if (!closed) await app.close();
    expect(readdirSync(boundary.directory)).toEqual([]);
    expect(boundary['sessions'].size).toBe(0);
    for (const thread of worker.created) expect(thread.threadId).toBe(-1);
    rmSync(directory, { recursive: true, force: true });
    jest.restoreAllMocks();
    keys.forEach((key, i) => {
      if (prior[i] === undefined) delete process.env[key];
      else process.env[key] = prior[i];
    });
  });
  const send = (bytes: string | Buffer, filename = 'save.hoi4') =>
    request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', Buffer.from(bytes), {
        filename,
        contentType: 'application/octet-stream',
      });
  const emptyStores = async () => {
    expect(cache['completed'].size).toBe(0);
    expect(cache['inFlight'].size).toBe(0);
    expect(await history.list()).toEqual([]);
  };

  test.each(['plain', 'zip'])(
    '%s success and cache hit clean their own uploads',
    async (kind) => {
      const bytes = kind === 'plain' ? smallSave() : zipSave();
      const a = await send(bytes).expect(201);
      const b = await send(bytes, 'renamed.hoi4').expect(201);
      expect(b.body).toEqual(a.body);
      expect(worker.created).toHaveLength(1);
      expect(readdirSync(boundary.directory)).toEqual([]);
    },
  );
  test.each([
    ['', 'save.hoi4', 400, 'EMPTY_FILE'],
    ['nonsense', 'save.hoi4', 400, 'INVALID_SAVE'],
    [Buffer.from([255, 216, 255]), 'photo.hoi4', 400, 'INVALID_SAVE'],
    ['EU4txt\nfoo=1', 'wrong.hoi4', 400, 'INVALID_SAVE'],
    [smallSave(), 'save', 415, 'UNSUPPORTED_FILE_TYPE'],
    [smallSave(), 'save.zip', 415, 'UNSUPPORTED_FILE_TYPE'],
    ['PKbroken', 'bad.hoi4', 400, 'CORRUPT_ARCHIVE'],
    [zipSave('x', 'readme.txt'), 'bad.hoi4', 422, 'UNSUPPORTED_SAVE'],
    [Buffer.alloc(8192, 65), 'large.hoi4', 413, 'FILE_TOO_LARGE'],
    [
      zipSave('HOI4txt\n' + 'A'.repeat(10000)),
      'bomb.hoi4',
      413,
      'DECOMPRESSED_SIZE_LIMIT',
    ],
  ])(
    'rejects invalid upload %# before Worker with safe code and no persistence',
    async (bytes, name, status, code) => {
      const response = await send(bytes, name).expect(status);
      expect(response.body).toMatchObject({ code });
      expect(response.text).not.toMatch(
        /stack|ENOENT|EPERM|Parse error|C:\\|\/tmp\//,
      );
      expect(worker.created).toHaveLength(0);
      await emptyStores();
    },
  );
  test.each([
    '../../evil.hoi4',
    '..\\..\\evil.hoi4',
    'C:\\Users\\evil\\save.hoi4',
    'Möwe Potosí 日本語.hoi4',
  ])(
    'filename %j is only sanitized metadata, never the disk path',
    async (filename) => {
      await send(smallSave(), filename).expect(201);
      const saved = (await history.list())[0];
      expect(saved.fileName).toBe(
        filename.includes('日本語')
          ? filename
          : filename.endsWith('save.hoi4')
            ? 'save.hoi4'
            : 'evil.hoi4',
      );
    },
  );
  test('forged ZIP size is bounded during Worker inflation and never cached', async () => {
    const response = await send(
      forgedZipSize(0, 'HOI4txt\n' + 'A'.repeat(12000)),
    ).expect(413);
    expect(response.body).toMatchObject({ code: 'DECOMPRESSED_SIZE_LIMIT' });
    expect(worker.created).toHaveLength(1);
    await emptyStores();
  });
  test.each(['countries={ GER={', 'name="unterminated'])(
    'incomplete structure %s fails without storing a partial result',
    async (extra) => {
      await send(smallSave(extra)).expect(400);
      await emptyStores();
    },
  );
  test('valid-looking unsupported input has its own safe category', async () => {
    const response = await send('HOI4txt\nunknown_mod_version={}').expect(422);
    expect(response.body).toMatchObject({ code: 'UNSUPPORTED_SAVE' });
    await emptyStores();
  });
  test('crash and timeout both clean files, release capacity, avoid stores and permit retry', async () => {
    worker.script = 'process.exit(7)';
    expect((await send(smallSave()).expect(500)).body).toMatchObject({
      code: 'ANALYSIS_FAILED',
    });
    await emptyStores();
    worker.script = 'while(true) {}';
    const response = await send(smallSave()).expect(504);
    expect(response.body).toMatchObject({ code: 'ANALYSIS_TIMEOUT' });
    await emptyStores();
    expect(readdirSync(boundary.directory)).toEqual([]);
    worker.script = null;
    await send(smallSave()).expect(201);
  }, 10000);
  test('persistence and history failures do not prevent upload cleanup', async () => {
    jest.spyOn(results, 'save').mockResolvedValueOnce(false);
    await send(smallSave()).expect(201);
    expect(readdirSync(boundary.directory)).toEqual([]);
    jest
      .spyOn(history as unknown as { persist: () => Promise<void> }, 'persist')
      .mockRejectedValue(new Error('private path'));
    await send(smallSave('mod=1')).expect(201);
  });
  test('JSON path types cannot throw an unhandled trim exception', async () => {
    await request(app.getHttpServer())
      .post('/api/analyze')
      .send({ path: { nested: 1 } })
      .expect(400);
    expect(worker.created).toHaveLength(0);
  });
  test('extra files, excessive fields and malformed multipart are bounded 400s', async () => {
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', Buffer.from(smallSave()), 'one.hoi4')
      .attach('file', Buffer.from(smallSave()), 'two.hoi4')
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/analyze')
      .field('one', '1')
      .field('two', '2')
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/analyze')
      .set('Content-Type', 'multipart/form-data')
      .send('no boundary')
      .expect(400);
    expect(worker.created).toHaveLength(0);
  });

  function partial() {
    let resolve!: (status: number) => void;
    const done = new Promise<number>((yes) => {
      resolve = yes;
    });
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/analyze',
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=partial' },
      },
      (res) => {
        res.resume();
        res.once('end', () => resolve(res.statusCode!));
      },
    );
    req.on('error', () => resolve(0));
    req.write(
      '--partial\r\nContent-Disposition: form-data; name="file"; filename="partial.hoi4"\r\n\r\nHOI4txt\n',
    );
    openRequests.push(req);
    return { req, done };
  }
  test('admission rejects the third pending upload before accepting its file', async () => {
    const a = partial();
    const b = partial();
    await until(() => readdirSync(boundary.directory).length === 2);
    const response = await send(smallSave()).expect(503);
    expect(response.body).toMatchObject({ code: 'ANALYZER_BUSY' });
    expect(readdirSync(boundary.directory)).toHaveLength(2);
    a.req.destroy();
    b.req.destroy();
    await until(
      () =>
        readdirSync(boundary.directory).length === 0 &&
        boundary['sessions'].size === 0,
    );
    await send(smallSave()).expect(201);
  });
  test('client disconnect during multipart removes the partial file and releases admission', async () => {
    const upload = partial();
    await until(() => readdirSync(boundary.directory).length === 1);
    upload.req.destroy();
    await until(
      () =>
        readdirSync(boundary.directory).length === 0 &&
        boundary['sessions'].size === 0,
    );
    expect(worker.created).toHaveLength(0);
    await emptyStores();
  });
  test('a stalled multipart upload has a deadline and its file is removed', async () => {
    const upload = partial();
    expect(await upload.done).toBe(408);
    await until(() => boundary['sessions'].size === 0);
    expect(readdirSync(boundary.directory)).toEqual([]);
  });
  test('a chunked over-limit multipart is stopped and releases admission', async () => {
    const upload = partial();
    upload.req.write(Buffer.alloc(8192, 65));
    upload.req.end();
    expect(await upload.done).toBe(413);
    await until(
      () =>
        readdirSync(boundary.directory).length === 0 &&
        boundary['sessions'].size === 0,
    );
    await send(smallSave()).expect(201);
  });
  test('graceful shutdown aborts a partial upload and cleans its file', async () => {
    const upload = partial();
    await until(() => readdirSync(boundary.directory).length === 1);
    await app.close();
    closed = true;
    expect(await upload.done).toBe(503);
    expect(readdirSync(boundary.directory)).toEqual([]);
    expect(boundary['sessions'].size).toBe(0);
  });
  test('graceful shutdown terminates an active Worker and cleans its upload', async () => {
    worker.script = 'while(true) {}';
    const response = send(smallSave()).then(
      (value) => value.status,
      () => 0,
    );
    await until(
      () =>
        worker.created.length === 1 &&
        readdirSync(boundary.directory).length === 1,
    );
    await app.close();
    closed = true;
    expect([0, 500]).toContain(await response);
    expect(worker.created[0].threadId).toBe(-1);
    expect(readdirSync(boundary.directory)).toEqual([]);
    expect(boundary['sessions'].size).toBe(0);
  });
  test('startup cleanup only removes stale owned regular files, preserving fresh/unrelated data', async () => {
    const stale = join(
      boundary.directory,
      'upload-123-11111111-1111-4111-8111-111111111111.hoi4',
    );
    const fresh = join(
      boundary.directory,
      'upload-123-22222222-2222-4222-8222-222222222222.hoi4',
    );
    const other = join(boundary.directory, 'unrelated.txt');
    const subdir = join(
      boundary.directory,
      'upload-123-33333333-3333-4333-8333-333333333333.hoi4',
    );
    for (const file of [stale, fresh, other]) writeFileSync(file, 'test');
    mkdirSync(subdir);
    const old = new Date(Date.now() - UPLOAD_STALE_MS - 3600000);
    utimesSync(stale, old, old);
    utimesSync(other, old, old);
    await boundary.cleanupStale();
    expect(readdirSync(boundary.directory).sort()).toEqual(
      [fresh, other, subdir].map((file) => file.split(/[\\/]/).at(-1)).sort(),
    );
    rmSync(fresh);
    rmSync(other);
    rmSync(subdir, { recursive: true });
  });
  test('startup cleanup failure warns without crashing the application', async () => {
    rmSync(boundary.directory, { recursive: true });
    await expect(boundary.cleanupStale()).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalled();
    mkdirSync(boundary.directory);
  });
  test('cleanup never unlinks a path this request did not create', async () => {
    const existing = join(
      boundary.directory,
      'upload-123-44444444-4444-4444-8444-444444444444.hoi4',
    );
    writeFileSync(existing, 'belongs to another request');
    await boundary['remove']({
      path: existing,
      owned: false,
    } as never);
    expect(readFileSync(existing, 'utf8')).toBe('belongs to another request');
    rmSync(existing);
  });
  test('a temp unlink failure warns and is swallowed', async () => {
    await expect(
      boundary['remove']({
        path: boundary.directory,
        owned: true,
      } as never),
    ).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalled();
  });
});
