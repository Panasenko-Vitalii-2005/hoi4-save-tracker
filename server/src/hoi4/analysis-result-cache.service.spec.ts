import { ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  AnalysisResultCacheService,
  hashSaveContents,
} from './analysis-result-cache.service';
import { Hoi4AnalysisWorkerService } from './hoi4-analysis-worker.service';
import { analyzeSave, type AnalyzeResult } from './hoi4-parser';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

class BlockingWorkerService extends Hoi4AnalysisWorkerService {
  block = false;
  readonly created: Worker[] = [];

  protected createWorker(filePath: string): Worker {
    const worker = this.block
      ? new Worker('setInterval(() => {}, 1000)', { eval: true, execArgv: [] })
      : super.createWorker(filePath);
    this.created.push(worker);
    return worker;
  }
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error('Timed out waiting for analysis');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe('AnalysisResultCacheService', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hoi4-cache-test-'));
  const paths = ['a', 'b', 'c', 'd'].map((name) =>
    join(directory, `${name}.hoi4`),
  );
  const sameBytes = join(directory, 'renamed.hoi4');
  const originalLimit = process.env.HOI4_ANALYSIS_CACHE_ENTRIES;
  let worker: Hoi4AnalysisWorkerService;
  let cache: AnalysisResultCacheService;
  let execute: jest.SpyInstance<Promise<AnalyzeResult>, [string]>;
  let result: AnalyzeResult;

  beforeAll(() => {
    paths.forEach((path, index) =>
      writeFileSync(
        path,
        `HOI4txt\ndate="1944.5.${index + 1}.2"\ncountries={}`,
      ),
    );
    writeFileSync(sameBytes, 'HOI4txt\ndate="1944.5.1.2"\ncountries={}');
    result = analyzeSave(paths[0]);
    Object.freeze(result);
  });

  beforeEach(() => {
    delete process.env.HOI4_ANALYSIS_CACHE_ENTRIES;
    worker = new Hoi4AnalysisWorkerService();
    execute = jest.spyOn(worker, 'analyze').mockResolvedValue(result);
    cache = new AnalysisResultCacheService(worker);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await worker.onModuleDestroy();
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
    if (originalLimit === undefined)
      delete process.env.HOI4_ANALYSIS_CACHE_ENTRIES;
    else process.env.HOI4_ANALYSIS_CACHE_ENTRIES = originalLimit;
  });

  test('streams exact raw bytes, including non-text bytes and multiple chunks', async () => {
    const path = join(directory, 'binary.hoi4');
    const bytes = Buffer.alloc(200_000, 0xff);
    bytes.set(Buffer.from('Möwe\0ARM Potosí', 'utf8'));
    writeFileSync(path, bytes);
    expect(await hashSaveContents(path)).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
  });

  test('returns an unchanged result and original parse_seconds on miss and hit', async () => {
    const before = JSON.stringify(result);
    expect(await cache.analyze(paths[0])).toBe(result);
    expect(await cache.analyze(paths[0])).toBe(result);
    expect(JSON.stringify(result)).toBe(before);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(cache['inFlight'].size).toBe(0);
  });

  test('identical contents under different paths share a cache entry', async () => {
    await cache.analyze(paths[0]);
    await cache.analyze(sameBytes);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test('explicit deletion forgets only the requested completed result and is idempotent', async () => {
    const { hash } = await cache.analyzeWithHash(paths[0]);
    await cache.analyze(paths[1]);
    cache.delete(hash);
    cache.delete(hash);
    await cache.analyze(paths[1]);
    expect(execute).toHaveBeenCalledTimes(2);
    await cache.analyze(paths[0]);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  test('deletion does not cancel shared in-flight work, whose later completion can repopulate', async () => {
    const pending = deferred<AnalyzeResult>();
    execute.mockReturnValueOnce(pending.promise);
    const hash = await hashSaveContents(paths[0]);
    const running = cache.analyze(paths[0]);
    await waitFor(() => execute.mock.calls.length === 1);
    cache.delete(hash);
    expect(cache['inFlight'].size).toBe(1);
    pending.resolve(result);
    expect(await running).toEqual(result);
    expect(await cache.analyze(paths[0])).toEqual(result);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test('different bytes under the same filename do not hit an old entry', async () => {
    const path = join(directory, 'changing.hoi4');
    writeFileSync(path, 'first');
    await cache.analyze(path);
    writeFileSync(path, 'other');
    await cache.analyze(path);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  test('hash read failures do not execute or cache an analysis', async () => {
    const path = join(directory, 'initially-missing.hoi4');
    await expect(cache.analyze(path)).rejects.toThrow('ENOENT');
    expect(execute).not.toHaveBeenCalled();
    expect(cache['inFlight'].size).toBe(0);
    writeFileSync(path, 'now available');
    await expect(cache.analyze(path)).resolves.toBe(result);
  });

  test.each([
    new Error('parser failure'),
    new Error('worker crash'),
    new ServiceUnavailableException('capacity full'),
  ])('never caches failure %s and retries successfully', async (failure) => {
    execute.mockRejectedValueOnce(failure);
    await expect(cache.analyze(paths[0])).rejects.toBe(failure);
    expect(cache['inFlight'].size).toBe(0);
    expect(cache['completed'].size).toBe(0);
    await expect(cache.analyze(paths[0])).resolves.toBe(result);
    await expect(cache.analyze(paths[0])).resolves.toBe(result);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  test('evicts the least recently accessed entry at the configured bound', async () => {
    process.env.HOI4_ANALYSIS_CACHE_ENTRIES = '2';
    cache = new AnalysisResultCacheService(worker);
    await cache.analyze(paths[0]);
    await cache.analyze(paths[1]);
    await cache.analyze(paths[0]); // A is now more recent than B.
    await cache.analyze(paths[2]); // C evicts B, not A.
    await cache.analyze(paths[0]);
    expect(execute).toHaveBeenCalledTimes(3);
    await cache.analyze(paths[1]);
    expect(execute).toHaveBeenCalledTimes(4);
    expect(cache['completed'].size).toBe(2);
  });

  test.each([
    undefined,
    '',
    '0',
    '-1',
    '1.5',
    'no',
    'Infinity',
    '9007199254740992',
  ])(
    'uses a bounded default of three for missing/invalid config %j',
    async (limit) => {
      if (limit === undefined) delete process.env.HOI4_ANALYSIS_CACHE_ENTRIES;
      else process.env.HOI4_ANALYSIS_CACHE_ENTRIES = limit;
      cache = new AnalysisResultCacheService(worker);
      for (const path of paths) await cache.analyze(path);
      expect(cache['completed'].size).toBe(3);
      await cache.analyze(paths[1]);
      expect(execute).toHaveBeenCalledTimes(4);
      await cache.analyze(paths[0]);
      expect(execute).toHaveBeenCalledTimes(5);
    },
  );

  test('same-hash concurrent callers share one analysis and release in-flight state', async () => {
    const pending = deferred<AnalyzeResult>();
    execute.mockReturnValueOnce(pending.promise);
    const lookups = jest.spyOn(cache['inFlight'], 'get');
    const first = cache.analyze(paths[0]);
    const second = cache.analyze(sameBytes);
    await waitFor(() => lookups.mock.calls.length === 2);
    expect(execute).toHaveBeenCalledTimes(1);
    pending.resolve(result);
    expect(await Promise.all([first, second])).toEqual([result, result]);
    expect(cache['inFlight'].size).toBe(0);
  });

  test('same-hash failure rejects every waiter, removes state, and permits retry', async () => {
    const pending = deferred<AnalyzeResult>();
    execute.mockReturnValueOnce(pending.promise);
    const lookups = jest.spyOn(cache['inFlight'], 'get');
    const all = Promise.allSettled([
      cache.analyze(paths[0]),
      cache.analyze(sameBytes),
    ]);
    await waitFor(() => lookups.mock.calls.length === 2);
    const failure = new Error('worker failed');
    pending.reject(failure);
    expect(await all).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(cache['inFlight'].size).toBe(0);
    expect(cache['completed'].size).toBe(0);
    await expect(cache.analyze(paths[0])).resolves.toBe(result);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  test('different hashes obey the real Worker limit while hits bypass capacity', async () => {
    const originalWorkerLimit = process.env.HOI4_ANALYSIS_WORKERS;
    process.env.HOI4_ANALYSIS_WORKERS = '1';
    const realWorker = new BlockingWorkerService();
    const realCache = new AnalysisResultCacheService(realWorker);
    try {
      const cached = await realCache.analyze(paths[0]);
      realWorker.block = true;
      const busy = expect(realCache.analyze(paths[1])).rejects.toThrow(
        'exited without a result',
      );
      await waitFor(() => realWorker.created.length === 2);
      await expect(realCache.analyze(paths[0])).resolves.toBe(cached);
      await expect(realCache.analyze(paths[2])).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(realWorker.created).toHaveLength(2);
      await realWorker.created[1].terminate();
      await busy;
      realWorker.block = false;
      await expect(realCache.analyze(paths[2])).resolves.toMatchObject({
        game_date: '1944.5.3',
      });
      expect(realWorker.created).toHaveLength(3);
    } finally {
      await realWorker.onModuleDestroy();
      if (originalWorkerLimit === undefined)
        delete process.env.HOI4_ANALYSIS_WORKERS;
      else process.env.HOI4_ANALYSIS_WORKERS = originalWorkerLimit;
    }
  });
});
