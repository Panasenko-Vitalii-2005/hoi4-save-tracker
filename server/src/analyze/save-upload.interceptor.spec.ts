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
  WriteStream,
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
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { Transform } from 'node:stream';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AnalyzeController } from './analyze.controller';
import { SaveUploadInterceptor } from './save-upload.interceptor';
import { Hoi4AnalysisWorkerService } from '../hoi4/hoi4-analysis-worker.service';
import { AnalysisResultCacheService } from '../hoi4/analysis-result-cache.service';
import { RecentAnalysesService } from './recent-analyses.service';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import { AnalysisComparisonService } from './analysis-comparison.service';
import {
  smallSave,
  binarySave,
  zipSave,
  forgedZipSize,
} from './fixtures/upload.fixture';
import { UPLOAD_STALE_MS } from '../hoi4/save-upload.policy';
import { AnalysisOwnershipService } from './analysis-ownership.service';
import { UserAnalysesService } from './user-analyses.service';
import type { SafeUserDto } from '../auth/auth.types';
import type { NextFunction, Request, Response } from 'express';
import { ProductEventsService } from '../telemetry/product-events.service';
import { configureAnalyzeRequestProfiling } from '../analyze-request-profile';

interface RequestSummary {
  requestId: string;
  requestEnteredMs: number;
  fileBytes: number;
  hashPrefix: string | null;
  cacheHit: boolean | null;
  cacheStatus: string | null;
  multipartCompleteMs: number | null;
  phases: Record<string, number | null>;
  responseBytes: number | null;
  responseFinishedMs: number | null;
  backendTotalMs: number;
  statusCode: number;
  outcome: string;
  errorCode: string | null;
}

function requestSummaries(
  log: jest.SpyInstance<void, unknown[]>,
): RequestSummary[] {
  return log.mock.calls
    .map((call) => call[0])
    .filter(
      (value): value is string =>
        typeof value === 'string' &&
        value.startsWith('[REQUEST_PROFILE] analyze '),
    )
    .map(
      (value) =>
        JSON.parse(
          value.slice('[REQUEST_PROFILE] analyze '.length),
        ) as RequestSummary,
    );
}

const USER: SafeUserDto = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'upload@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const gunzipDescriptor = Object.getOwnPropertyDescriptor(zlib, 'createGunzip')!;

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
    'HOI4_REQUEST_PROFILE',
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
    delete process.env.HOI4_REQUEST_PROFILE;
    warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const module = await Test.createTestingModule({
      controllers: [AnalyzeController],
      providers: [
        SaveUploadInterceptor,
        {
          provide: ProductEventsService,
          useValue: {
            recordStarted: jest.fn().mockResolvedValue(true),
            recordRejected: jest.fn().mockResolvedValue(true),
            recordCompleted: jest.fn().mockResolvedValue(true),
            recordFailed: jest.fn().mockResolvedValue(true),
          },
        },
        { provide: Hoi4AnalysisWorkerService, useClass: TestWorker },
        AnalysisResultCacheService,
        RecentAnalysesService,
        PersistedAnalysisResultService,
        AnalysisComparisonService,
        {
          provide: AnalysisOwnershipService,
          useValue: {
            ensureOwnership: jest.fn().mockResolvedValue(undefined),
            listAllOwnedHashes: jest.fn().mockResolvedValue(new Set()),
          },
        },
        { provide: UserAnalysesService, useValue: {} },
      ],
    }).compile();
    boundary = module.get(SaveUploadInterceptor);
    worker = module.get(Hoi4AnalysisWorkerService);
    cache = module.get(AnalysisResultCacheService);
    history = module.get(RecentAnalysesService);
    results = module.get(PersistedAnalysisResultService);
    app = module.createNestApplication();
    configureAnalyzeRequestProfiling(app);
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
    Object.defineProperty(zlib, 'createGunzip', gunzipDescriptor);
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

  const sendGzip = (bytes: Buffer, encoding = 'gzip') =>
    request(app.getHttpServer())
      .post('/api/analyze')
      .field('transportEncoding', encoding)
      .attach('file', bytes, {
        filename: 'save.hoi4',
        contentType: 'application/octet-stream',
      });

  test.each(['plain-first', 'gzip-first'])(
    '%s transport preserves original bytes, SHA, result and metadata on cache hit',
    async (order) => {
      const bytes = Buffer.from(smallSave('# Möwe 日本語\n'));
      const staged: Buffer[] = [];
      const original = cache.analyzeWithHash.bind(cache);
      jest.spyOn(cache, 'analyzeWithHash').mockImplementation((path) => {
        staged.push(readFileSync(path));
        return original(path);
      });
      const plain = () => send(bytes);
      const gzip = () => sendGzip(gzipSync(bytes));
      const first = await (order === 'plain-first' ? plain() : gzip()).expect(
        201,
      );
      const second = await (order === 'plain-first' ? gzip() : plain()).expect(
        201,
      );
      expect(staged).toEqual([bytes, bytes]);
      expect(first.headers['x-analysis-hash']).toBe(
        createHash('sha256').update(bytes).digest('hex'),
      );
      expect(second.headers['x-analysis-hash']).toBe(
        first.headers['x-analysis-hash'],
      );
      expect(second.body).toEqual(first.body);
      expect(worker.created).toHaveLength(1);
      expect((await history.list())[0]).toMatchObject({
        fileSizeBytes: bytes.length,
        fileName: 'save.hoi4',
      });
      expect(readdirSync(boundary.directory)).toEqual([]);
    },
  );

  test('gzip transport works with the existing batch acknowledgement contract', async () => {
    const bytes = Buffer.from(smallSave());
    const response = await sendGzip(gzipSync(bytes))
      .query({ response: 'batch' })
      .expect(201);
    expect(response.body).toMatchObject({
      hash: createHash('sha256').update(bytes).digest('hex'),
      gameDate: '1944.5.1',
    });
    expect(response.body).not.toHaveProperty('by_country');
  });

  test.each(['br', 'identity', '', 'GZIP'])(
    'unsupported marker %j is rejected before Worker',
    async (marker) => {
      await sendGzip(gzipSync(Buffer.from(smallSave())), marker).expect(400);
      expect(worker.created).toHaveLength(0);
      await emptyStores();
    },
  );

  test('late and duplicate transport markers are rejected, not reinterpreted', async () => {
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', Buffer.from(smallSave()), 'save.hoi4')
      .field('transportEncoding', 'gzip')
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/analyze')
      .field('transportEncoding', 'gzip')
      .field('transportEncoding', 'gzip')
      .attach('file', gzipSync(Buffer.from(smallSave())), 'save.hoi4')
      .expect(400);
    expect(worker.created).toHaveLength(0);
  });

  test('gzip without the explicit marker is never auto-detected', async () => {
    await send(gzipSync(Buffer.from(smallSave()))).expect(400);
    expect(worker.created).toHaveLength(0);
  });

  test.each(['malformed', 'truncated', 'crc'])(
    '%s gzip is rejected safely and releases admission',
    async (kind) => {
      const gzip = gzipSync(Buffer.from(smallSave()));
      const bytes =
        kind === 'malformed'
          ? Buffer.from('not gzip')
          : kind === 'truncated'
            ? gzip.subarray(0, gzip.length - 8)
            : Buffer.from(gzip);
      if (kind === 'crc') bytes[bytes.length - 8] ^= 1;
      const response = await sendGzip(bytes).expect(400);
      expect(response.body).toMatchObject({ code: 'CORRUPT_ARCHIVE' });
      expect(response.text).not.toMatch(/stack|Z_DATA|Z_BUF|\/tmp\/|C:\\/);
      expect(worker.created).toHaveLength(0);
      await emptyStores();
      await send(smallSave()).expect(201);
    },
  );

  test('transport gzip cannot increase the existing plaintext size limit, including false ISIZE', async () => {
    const gzip = gzipSync(Buffer.from('HOI4txt\n' + 'A'.repeat(1024 * 1024)));
    gzip.writeUInt32LE(1, gzip.length - 4);
    const response = await sendGzip(gzip).expect(413);
    expect(response.body).toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(worker.created).toHaveLength(0);
    await emptyStores();
  });

  test('the independent uncompressed limit also applies when smaller than upload limit', async () => {
    boundary.policy.maxUncompressedBytes = 1024;
    const response = await sendGzip(
      gzipSync(Buffer.from('HOI4txt\n' + 'A'.repeat(2000))),
    ).expect(413);
    expect(response.body).toMatchObject({ code: 'DECOMPRESSED_SIZE_LIMIT' });
    expect(worker.created).toHaveLength(0);
    await emptyStores();
  });

  test('compressed byte cap rejects large gzip headers even for a tiny original save', async () => {
    const gzip = gzipSync(Buffer.from(smallSave()));
    const header = Buffer.from(gzip.subarray(0, 10));
    header[3] |= 8; // Valid FNAME header: metadata must not bypass the wire cap.
    const bytes = Buffer.concat([
      header,
      Buffer.alloc(8192, 65),
      Buffer.from([0]),
      gzip.subarray(10),
    ]);
    await sendGzip(bytes).expect(413);
    expect(worker.created).toHaveLength(0);
    await emptyStores();
  });

  test('binary rejection remains unchanged after gzip normalization', async () => {
    const response = await sendGzip(gzipSync(binarySave())).expect(422);
    expect(response.body).toMatchObject({ code: 'UNSUPPORTED_BINARY_SAVE' });
    expect(worker.created).toHaveLength(0);
    await emptyStores();
  });

  test('disconnect during gzip normalization cleans up and releases admission', async () => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/analyze',
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=gzabort' },
    });
    req.on('error', () => {});
    openRequests.push(req);
    req.write(
      '--gzabort\r\nContent-Disposition: form-data; name="transportEncoding"\r\n\r\ngzip\r\n--gzabort\r\nContent-Disposition: form-data; name="file"; filename="save.hoi4"\r\n\r\n',
    );
    req.write(gzipSync(Buffer.from(smallSave())).subarray(0, 16));
    await until(() => readdirSync(boundary.directory).length === 1);
    req.destroy();
    await until(
      () =>
        boundary['sessions'].size === 0 &&
        readdirSync(boundary.directory).length === 0,
    );
    expect(worker.created).toHaveLength(0);
    await sendGzip(gzipSync(Buffer.from(smallSave()))).expect(201);
  });

  test('normalization never writes a chunk exceeding the original-byte cap', async () => {
    const writes = jest.spyOn(WriteStream.prototype, '_write');
    await sendGzip(gzipSync(Buffer.alloc(128 * 1024, 65))).expect(413);
    // Gunzip's first output chunk already exceeds this test's 4096-byte cap.
    expect(writes).not.toHaveBeenCalled();
    expect(worker.created).toHaveLength(0);
  });

  test.each(['disconnect', 'timeout'])(
    '%s stops normalization even after the complete multipart input has arrived',
    async (kind) => {
      let flushing = false;
      const delayed = new Transform({
        transform(_chunk, _encoding, done) {
          done(null, Buffer.from(smallSave()));
        },
        flush() {
          flushing = true;
        }, // Controlled delayed native inflater completion.
      });
      // Node's factory is read-only but configurable; replace only this one call.
      Object.defineProperty(zlib, 'createGunzip', {
        ...gunzipDescriptor,
        value: () => {
          Object.defineProperty(zlib, 'createGunzip', gunzipDescriptor);
          return delayed;
        },
      });
      const body = Buffer.concat([
        Buffer.from(
          '--gzflush\r\nContent-Disposition: form-data; name="transportEncoding"\r\n\r\ngzip\r\n--gzflush\r\nContent-Disposition: form-data; name="file"; filename="save.hoi4"\r\n\r\n',
        ),
        gzipSync(Buffer.from(smallSave())),
        Buffer.from('\r\n--gzflush--\r\n'),
      ]);
      let req!: ClientRequest;
      const status = new Promise<number>((resolve) => {
        req = httpRequest(
          {
            hostname: '127.0.0.1',
            port,
            path: '/api/analyze',
            method: 'POST',
            headers: {
              'Content-Type': 'multipart/form-data; boundary=gzflush',
              'Content-Length': body.length,
            },
          },
          (response) => {
            response.resume();
            response.once('end', () => resolve(response.statusCode!));
          },
        );
        req.on('error', () => resolve(0));
        openRequests.push(req);
        req.end(body);
      });
      await until(() => flushing);
      if (kind === 'disconnect') req.destroy();
      else expect(await status).toBe(408);
      await until(() => boundary['sessions'].size === 0);
      expect(delayed.destroyed).toBe(true);
      expect(readdirSync(boundary.directory)).toEqual([]);
      expect(worker.created).toHaveLength(0);
      await send(smallSave()).expect(201);
    },
  );

  test('normalization disk failure is safe, cleans its file and releases admission', async () => {
    jest
      .spyOn(WriteStream.prototype, '_write')
      .mockImplementationOnce((_chunk, _encoding, done) => {
        done(Object.assign(new Error('private disk path'), { code: 'ENOSPC' }));
      });
    const response = await sendGzip(gzipSync(Buffer.from(smallSave()))).expect(
      500,
    );
    expect(response.body).toMatchObject({ code: 'ANALYSIS_FAILED' });
    expect(response.text).not.toMatch(/private disk|ENOSPC|stack/);
    expect(readdirSync(boundary.directory)).toEqual([]);
    expect(boundary['sessions'].size).toBe(0);
    await emptyStores();
    await sendGzip(gzipSync(Buffer.from(smallSave()))).expect(201);
  });

  test('the absolute cap covers all concatenated gzip members', async () => {
    const member = gzipSync(Buffer.alloc(1000, 65));
    await sendGzip(
      Buffer.concat([member, member, member, member, member]),
    ).expect(413);
    expect(worker.created).toHaveLength(0);
    await emptyStores();
  });

  test('disabled profiling leaves successful request logging unchanged', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    await send(smallSave()).expect(201);
    expect(requestSummaries(log)).toEqual([]);
  });

  test('miss and hit each emit once at finish without changing API or telemetry', async () => {
    process.env.HOI4_REQUEST_PROFILE = '1';
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const bytes = smallSave();
    const a = await send(bytes).expect(201);
    const b = await send(bytes).expect(201);
    expect(b.body).toEqual(a.body);
    expect(b.headers['x-analysis-hash']).toBe(a.headers['x-analysis-hash']);
    expect(a.headers['x-analysis-persistence']).toBe('saved');
    expect(b.headers['x-analysis-persistence']).toBe('saved');
    expect(worker.created).toHaveLength(1);
    expect(await results.get(a.headers['x-analysis-hash'])).toStrictEqual(
      [...cache['completed'].values()][0].result,
    );
    const summaries = requestSummaries(log);
    expect(summaries).toHaveLength(2);
    const [miss, hit] = summaries;
    expect(miss.requestId).not.toBe(hit.requestId);
    expect(miss.cacheHit).toBe(false);
    expect(miss.cacheStatus).toBe('miss');
    expect(miss.phases.workerMs).toBeGreaterThan(0);
    expect(miss.phases.parserMs).toEqual(expect.any(Number));
    expect(miss.phases.workerOutsideParserMs).toEqual(expect.any(Number));
    expect(hit.cacheHit).toBe(true);
    expect(hit.cacheStatus).toBe('hit');
    expect(hit.phases.workerAdmissionMs).toBeNull();
    expect(hit.phases.workerMs).toBeNull();
    expect(hit.phases.parserMs).toBeNull();
    expect(hit.phases.workerOutsideParserMs).toBeNull();
    for (const [index, summary] of summaries.entries()) {
      const response = index === 0 ? a : b;
      expect(summary).toMatchObject({
        requestEnteredMs: 0,
        fileBytes: Buffer.byteLength(bytes),
        hashPrefix: a.headers['x-analysis-hash'].slice(0, 12),
        outcome: 'completed',
        statusCode: 201,
        responseBytes: Buffer.byteLength(response.text),
      });
      expect(summary.multipartCompleteMs).toBeGreaterThan(0);
      expect(summary.phases.multipartMs).toBe(summary.multipartCompleteMs);
      expect(summary.phases.validationMs).toEqual(expect.any(Number));
      expect(summary.phases.sha256Ms).toEqual(expect.any(Number));
      expect(summary.phases.cacheLookupMs).toEqual(expect.any(Number));
      expect(summary.phases.artifactLoadMs).toEqual(expect.any(Number));
      expect(summary.phases.artifactPersistenceMs).toBeGreaterThan(0);
      // Serialization is also used to compare the exact JSON result on reuse.
      expect(summary.phases.artifactSerializationMs).toEqual(
        expect.any(Number),
      );
      if (index === 0) {
        expect(summary.phases.artifactCompressionMs).toEqual(
          expect.any(Number),
        );
      } else {
        // Valid identical artifact reuse on a cache hit performs no compression/write.
        expect(summary.phases.artifactCompressionMs).toBeNull();
      }
      expect(summary.phases.historyQueueWaitMs).toEqual(expect.any(Number));
      expect(summary.phases.historyMetadataMs).toEqual(expect.any(Number));
      expect(summary.phases.ownershipDatabaseMs).toEqual(expect.any(Number));
      expect(summary.phases.responsePreparationMs).toEqual(expect.any(Number));
      expect(summary.responseFinishedMs).toBe(summary.backendTotalMs);
      expect(summary.backendTotalMs).toBeGreaterThanOrEqual(
        summary.multipartCompleteMs!,
      );
    }
    const telemetry = app.get(ProductEventsService);
    const started = jest.spyOn(telemetry, 'recordStarted');
    const completed = jest.spyOn(telemetry, 'recordCompleted');
    const rejected = jest.spyOn(telemetry, 'recordRejected');
    const failed = jest.spyOn(telemetry, 'recordFailed');
    expect(started).toHaveBeenCalledTimes(2);
    expect(completed).toHaveBeenCalledTimes(2);
    expect(rejected).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    for (const [attempt, properties] of completed.mock.calls) {
      expect(attempt).toMatchObject({
        stage: 'persistence',
        terminalRecorded: true,
      });
      expect(Object.keys(properties)).toEqual([
        'totalDurationMs',
        'persistenceOutcome',
      ]);
      expect(properties.persistenceOutcome).toBe('saved');
      expect(properties.totalDurationMs).toEqual(expect.any(Number));
    }
  });

  test('coalesced request measures shared wait, not another Worker/parser', async () => {
    process.env.HOI4_REQUEST_PROFILE = '1';
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const first = send(smallSave())
      .expect(201)
      .then((response) => response);
    await until(() => worker.created.length === 1);
    const second = await send(smallSave()).expect(201);
    expect(second.body).toEqual((await first).body);
    expect(worker.created).toHaveLength(1);
    const summaries = requestSummaries(log);
    expect(summaries).toHaveLength(2);
    const waiter = summaries.find(
      (summary) => summary.cacheStatus === 'in_flight',
    );
    expect(waiter).toBeDefined();
    expect(waiter?.cacheHit).toBe(false);
    expect(waiter?.phases.sharedAnalysisWaitMs).toBeGreaterThan(0);
    expect(waiter?.phases.workerMs).toBeNull();
    expect(waiter?.phases.parserMs).toBeNull();
  });

  test('multipart time includes body arrival delay before controller, not just staging', async () => {
    process.env.HOI4_REQUEST_PROFILE = '1';
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const bytes = smallSave();
    const prefix =
      '--delayed\r\nContent-Disposition: form-data; name="file"; filename="save.hoi4"\r\n\r\n';
    let req!: ClientRequest;
    const done = new Promise<number>((resolve, reject) => {
      req = httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/analyze',
          method: 'POST',
          headers: { 'Content-Type': 'multipart/form-data; boundary=delayed' },
        },
        (response) => {
          response.resume();
          response.once('end', () => resolve(response.statusCode!));
        },
      );
      req.on('error', reject);
      openRequests.push(req);
      req.write(prefix + bytes.slice(0, 8));
    });
    await until(() => boundary['sessions'].size === 1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(requestSummaries(log)).toHaveLength(0);
    expect(worker.created).toHaveLength(0);
    req.end(bytes.slice(8) + '\r\n--delayed--\r\n');
    expect(await done).toBe(201);
    const summaries = requestSummaries(log);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].multipartCompleteMs).toBeGreaterThanOrEqual(35);
    expect(summaries[0].fileBytes).toBe(Buffer.byteLength(bytes));
  });

  test('failure summary is bounded and contains no input, paths or auth details', async () => {
    process.env.HOI4_REQUEST_PROFILE = '1';
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    await request(app.getHttpServer())
      .post('/api/analyze')
      .set('Cookie', 'session=private-token')
      .set('X-CSRF-Token', 'private-csrf')
      .attach(
        'file',
        Buffer.from('confidential-save-data'),
        'private-filename.hoi4',
      )
      .expect(400);
    const summaries = requestSummaries(log);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      outcome: 'failed',
      errorCode: 'INVALID_SAVE',
      statusCode: 400,
    });
    expect(summaries[0].phases.workerMs).toBeNull();
    expect(summaries[0].phases.parserMs).toBeNull();
    expect(summaries[0].hashPrefix).toBeNull();
    const serialized = JSON.stringify(summaries);
    for (const secret of [
      'private-token',
      'private-csrf',
      'private-filename',
      'confidential-save-data',
      USER.email,
      USER.id,
      directory,
    ])
      expect(serialized).not.toContain(secret);
    expect(serialized).not.toMatch(/stack|ENOENT|EPERM/);
  });

  test('multipart client abort emits exactly one close summary', async () => {
    process.env.HOI4_REQUEST_PROFILE = '1';
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const upload = partial();
    await until(() => readdirSync(boundary.directory).length === 1);
    upload.req.destroy();
    await until(
      () =>
        boundary['sessions'].size === 0 && requestSummaries(log).length === 1,
    );
    expect(requestSummaries(log)[0]).toMatchObject({
      outcome: 'aborted',
      responseFinishedMs: null,
      multipartCompleteMs: null,
    });
    expect(worker.created).toHaveLength(0);
  });

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
  test.each([
    ['plain', binarySave(), 0],
    ['zip', zipSave(binarySave()), 1],
  ])(
    '%s binary save receives an actionable format error and is never persisted',
    async (_kind, bytes, workerCount) => {
      const response = await send(bytes).expect(422);
      expect(response.body).toMatchObject({
        code: 'UNSUPPORTED_BINARY_SAVE',
      });
      expect(response.text).not.toMatch(/stack|ENOENT|C:\\|\/tmp\//);
      expect(worker.created).toHaveLength(workerCount);
      await emptyStores();
    },
  );
  test.each(['plain', 'gzip'])(
    '%s crash and timeout both clean files, release capacity, avoid stores and permit retry',
    async (kind) => {
      const upload = (text: string) =>
        kind === 'gzip' ? sendGzip(gzipSync(Buffer.from(text))) : send(text);
      worker.script = 'process.exit(7)';
      expect((await upload(smallSave()).expect(500)).body).toMatchObject({
        code: 'ANALYSIS_FAILED',
      });
      await emptyStores();
      worker.script = 'while(true) {}';
      const response = await upload(smallSave()).expect(504);
      expect(response.body).toMatchObject({ code: 'ANALYSIS_TIMEOUT' });
      await emptyStores();
      expect(readdirSync(boundary.directory)).toEqual([]);
      worker.script = null;
      await upload(smallSave()).expect(201);
    },
    10000,
  );
  test.each(['plain', 'gzip'])(
    '%s persistence and history failures do not prevent upload cleanup',
    async (kind) => {
      const upload = (text: string) =>
        kind === 'gzip' ? sendGzip(gzipSync(Buffer.from(text))) : send(text);
      jest.spyOn(results, 'save').mockResolvedValueOnce(false);
      await upload(smallSave()).expect(201);
      expect(readdirSync(boundary.directory)).toEqual([]);
      jest
        .spyOn(
          history as unknown as { persist: () => Promise<void> },
          'persist',
        )
        .mockRejectedValue(new Error('private path'));
      await upload(smallSave('mod=1')).expect(201);
    },
  );
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
