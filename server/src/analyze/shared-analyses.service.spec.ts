import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import files from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeSave, type AnalyzeResult } from '../hoi4/hoi4-parser';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import { RecentAnalysesService } from './recent-analyses.service';
import {
  normalizeShareId,
  SharedAnalysesService,
  SharedAnalysisLimitError,
} from './shared-analyses.service';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

class DeterministicSharedAnalysesService extends SharedAnalysesService {
  constructor(
    results: PersistedAnalysisResultService,
    private readonly ids: string[],
  ) {
    super(results);
  }

  protected generateId(): string {
    return this.ids.shift() ?? super.generateId();
  }
}

describe('SharedAnalysesService', () => {
  const originalShareFile = process.env.HOI4_SHARED_ANALYSES_FILE;
  const originalShareLimit = process.env.HOI4_SHARED_ANALYSES_LIMIT;
  const originalRecentFile = process.env.HOI4_RECENT_ANALYSES_FILE;
  const originalRecentLimit = process.env.HOI4_RECENT_ANALYSES_LIMIT;
  const originalResultDirectory = process.env.HOI4_ANALYSIS_RESULTS_DIR;
  const originalResultLimit = process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES;
  let directory: string;
  let shareFile: string;
  let results: PersistedAnalysisResultService;
  let shares: SharedAnalysesService;
  let result: AnalyzeResult;
  let warn: jest.SpyInstance;

  beforeEach(async () => {
    directory = await files.mkdtemp(join(tmpdir(), 'hoi4-shares-'));
    shareFile = join(directory, 'data', 'shares.json');
    process.env.HOI4_SHARED_ANALYSES_FILE = shareFile;
    process.env.HOI4_RECENT_ANALYSES_FILE = join(
      directory,
      'data',
      'recent.json',
    );
    process.env.HOI4_ANALYSIS_RESULTS_DIR = join(directory, 'results');
    delete process.env.HOI4_SHARED_ANALYSES_LIMIT;
    delete process.env.HOI4_RECENT_ANALYSES_LIMIT;
    delete process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES;
    const save = join(directory, 'fixture.hoi4');
    await files.writeFile(save, 'HOI4txt\ndate="1944.5.1.2"\ncountries={}');
    result = analyzeSave(save);
    results = new PersistedAnalysisResultService();
    shares = new SharedAnalysesService(results);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    await shares.protection();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await files.rm(directory, { recursive: true, force: true });
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('HOI4_SHARED_ANALYSES_FILE', originalShareFile);
    restore('HOI4_SHARED_ANALYSES_LIMIT', originalShareLimit);
    restore('HOI4_RECENT_ANALYSES_FILE', originalRecentFile);
    restore('HOI4_RECENT_ANALYSES_LIMIT', originalRecentLimit);
    restore('HOI4_ANALYSIS_RESULTS_DIR', originalResultDirectory);
    restore('HOI4_ANALYSIS_RESULTS_MAX_BYTES', originalResultLimit);
  });

  test('creates a URL-safe 128-bit identifier without exposing the analysis hash', async () => {
    await results.save(hash('a'), result);
    const link = await shares.create(hash('a'));
    expect(link).toEqual({
      id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/) as unknown,
      path: expect.stringMatching(/^\/share\/[A-Za-z0-9_-]{22}$/) as unknown,
    });
    expect(normalizeShareId(link!.id)).toBe(link!.id);
    expect(JSON.stringify(link)).not.toContain(hash('a'));
  });

  test('persists one minimal record per hash and returns the same link after restart', async () => {
    await results.save(hash('a'), result);
    const first = await shares.create(hash('a'));
    expect(await shares.create(hash('a').toUpperCase())).toEqual(first);
    shares = new SharedAnalysesService(results);
    expect(await shares.create(hash('a'))).toEqual(first);
    const stored = await files.readFile(shareFile, 'utf8');
    expect(JSON.parse(stored)).toEqual({
      formatVersion: 1,
      items: [
        {
          id: first!.id,
          hash: hash('a'),
          createdAt: expect.any(String) as unknown,
        },
      ],
    });
    expect(stored).not.toMatch(
      /fileName|result|game_date|parse_seconds|sourceOffset|warning/i,
    );
  });

  test('serializes concurrent duplicate creation to one stable record', async () => {
    await results.save(hash('a'), result);
    const created = await Promise.all(
      Array.from({ length: 8 }, () => shares.create(hash('a'))),
    );
    expect(new Set(created.map((link) => link?.id)).size).toBe(1);
    expect(
      (
        JSON.parse(await files.readFile(shareFile, 'utf8')) as {
          items: unknown[];
        }
      ).items,
    ).toHaveLength(1);
  });

  test('checks generated ID collisions without merging distinct analyses', async () => {
    await results.save(hash('a'), result);
    await results.save(hash('b'), result);
    const collision = 'AAAAAAAAAAAAAAAAAAAAAA';
    const replacement = 'BBBBBBBBBBBBBBBBBBBBBB';
    shares = new DeterministicSharedAnalysesService(results, [
      collision,
      collision,
      replacement,
    ]);
    expect((await shares.create(hash('a')))?.id ?? '').toBe(collision);
    expect((await shares.create(hash('b')))?.id ?? '').toBe(replacement);
  });

  test('opens the exact persisted result without mutating recent history', async () => {
    const history = new RecentAnalysesService(results, shares);
    await history.record(
      { hash: hash('a'), fileName: 'private.hoi4', fileSizeBytes: 100 },
      result,
    );
    const before = await history.list();
    const link = await shares.create(hash('a'));
    expect(await shares.getResult(link!.id)).toEqual(result);
    expect(await history.list()).toEqual(before);
  });

  test('persisting a recent analysis does not make it public automatically', async () => {
    const history = new RecentAnalysesService(results, shares);
    await history.record(
      { hash: hash('a'), fileName: 'private.hoi4', fileSizeBytes: 100 },
      result,
    );

    expect((await shares.protection()).references).toEqual([]);
    await expect(files.readFile(shareFile)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('rejects unsafe IDs before persisted result access', async () => {
    const get = jest.spyOn(results, 'get');
    for (const id of [
      '',
      'short',
      '../private-result',
      '..\\private-result',
      'A'.repeat(21),
      'A'.repeat(23),
      'A'.repeat(21) + '=',
    ]) {
      expect(await shares.getResult(id)).toBeNull();
      expect(normalizeShareId(id)).toBeNull();
    }
    expect(get).not.toHaveBeenCalled();
  });

  test('unknown persisted hash cannot create a fabricated link', async () => {
    expect(await shares.create(hash('missing'))).toBeNull();
    await expect(files.readFile(shareFile)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('revocation is idempotent and leaves a still-recent result available', async () => {
    const history = new RecentAnalysesService(results, shares);
    await history.record(
      { hash: hash('a'), fileName: 'a.hoi4', fileSizeBytes: 100 },
      result,
    );
    const link = await shares.create(hash('a'));
    expect(await history.revokeShare(hash('a'))).toBe(true);
    expect(await history.revokeShare(hash('a'))).toBe(false);
    expect(await shares.getResult(link!.id)).toBeNull();
    expect(await results.get(hash('a'))).toEqual(result);
  });

  test('revocation remains revoked after service restart', async () => {
    await results.save(hash('a'), result);
    const link = await shares.create(hash('a'));
    expect(await shares.revokeByHash(hash('a'))).toBe(true);
    shares = new SharedAnalysesService(results);
    expect(await shares.getResult(link!.id)).toBeNull();
    expect((await shares.protection()).references).toEqual([]);
  });

  test.each(['delete', 'clear', 'count eviction'])(
    'active share protects its result from recent-history %s',
    async (operation) => {
      if (operation === 'count eviction')
        process.env.HOI4_RECENT_ANALYSES_LIMIT = '1';
      const history = new RecentAnalysesService(results, shares);
      await history.record(
        { hash: hash('a'), fileName: 'a.hoi4', fileSizeBytes: 100 },
        result,
      );
      const link = await shares.create(hash('a'));
      if (operation === 'delete') await history.delete(hash('a'));
      else if (operation === 'clear') await history.clear();
      else
        await history.record(
          { hash: hash('b'), fileName: 'b.hoi4', fileSizeBytes: 100 },
          result,
        );
      expect(
        (await history.list()).some((item) => item.hash === hash('a')),
      ).toBe(false);
      expect(await shares.getResult(link!.id)).toEqual(result);
      expect(await results.exists(hash('a'))).toBe(true);
    },
  );

  test('revoking after recent deletion removes the now-unreferenced result', async () => {
    const history = new RecentAnalysesService(results, shares);
    await history.record(
      { hash: hash('a'), fileName: 'a.hoi4', fileSizeBytes: 100 },
      result,
    );
    await shares.create(hash('a'));
    await history.delete(hash('a'));
    expect(await results.exists(hash('a'))).toBe(true);
    expect(await history.revokeShare(hash('a'))).toBe(true);
    expect(await results.exists(hash('a'))).toBe(false);
  });

  test('unshared Recent deletion keeps its existing durable-result cleanup', async () => {
    const history = new RecentAnalysesService(results, shares);
    await history.record(
      { hash: hash('a'), fileName: 'a.hoi4', fileSizeBytes: 100 },
      result,
    );
    await history.delete(hash('a'));
    expect(await results.exists(hash('a'))).toBe(false);
    expect(await history.list()).toEqual([]);
  });

  test('missing result is reconciled on restart and the stale link is removed', async () => {
    await results.save(hash('a'), result);
    const link = await shares.create(hash('a'));
    await results.delete(hash('a'));
    shares = new SharedAnalysesService(results);
    expect(await shares.getResult(link!.id)).toBeNull();
    expect(
      (
        JSON.parse(await files.readFile(shareFile, 'utf8')) as {
          items: unknown[];
        }
      ).items,
    ).toEqual([]);
  });

  test('one malformed record is ignored while valid links survive', async () => {
    await results.save(hash('a'), result);
    const link = await shares.create(hash('a'));
    const stored = JSON.parse(await files.readFile(shareFile, 'utf8')) as {
      items: unknown[];
    };
    stored.items.push({ id: '../bad', hash: hash('b'), createdAt: 'bad' });
    await files.writeFile(
      shareFile,
      JSON.stringify({ formatVersion: 1, items: stored.items }),
    );
    shares = new SharedAnalysesService(results);
    expect(await shares.getResult(link!.id)).toEqual(result);
    expect((await shares.protection()).reliable).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  test('corrupt share metadata warns once and does not delete unknown persisted results', async () => {
    await results.save(hash('a'), result);
    await files.mkdir(join(directory, 'data'), { recursive: true });
    await files.writeFile(shareFile, '{broken');
    shares = new SharedAnalysesService(results);
    const history = new RecentAnalysesService(results, shares);
    expect(await history.list()).toEqual([]);
    expect(await history.list()).toEqual([]);
    expect(await results.get(hash('a'))).toEqual(result);
    expect((await shares.protection()).reliable).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(directory);
  });

  test('hard byte cap evicts shared results only as a last resort and invalidates links', async () => {
    await results.save(hash('a'), result);
    const link = await shares.create(hash('a'));
    const size = (
      await files.stat(join(directory, 'results', `${hash('a')}.json.gz`))
    ).size;
    await results.save(hash('b'), result);
    process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = '1';
    results = new PersistedAnalysisResultService();
    shares = new SharedAnalysesService(results);
    const history = new RecentAnalysesService(results, shares);
    await history.list();
    expect(await results.exists(hash('a'))).toBe(false);
    expect(await results.exists(hash('b'))).toBe(false);
    expect(await shares.getResult(link!.id)).toBeNull();
    shares = new SharedAnalysesService(results);
    expect(await shares.getResult(link!.id)).toBeNull();
    expect((await shares.protection()).references).toEqual([]);
    expect(size).toBeGreaterThan(1);
  });

  test('shared result outranks pinned and ordinary results during disk eviction', async () => {
    let history = new RecentAnalysesService(results, shares);
    await history.record(
      { hash: hash('a'), fileName: 'a.hoi4', fileSizeBytes: 100 },
      result,
    );
    const size = (
      await files.stat(join(directory, 'results', `${hash('a')}.json.gz`))
    ).size;
    await shares.create(hash('a'));
    await history.record(
      { hash: hash('b'), fileName: 'b.hoi4', fileSizeBytes: 100 },
      result,
    );
    await history.setPinned(hash('b'), true);
    process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = String(size + 100);
    results = new PersistedAnalysisResultService();
    shares = new SharedAnalysesService(results);
    history = new RecentAnalysesService(results, shares);
    await history.list();
    expect(await results.exists(hash('a'))).toBe(true);
    expect(await results.exists(hash('b'))).toBe(false);
  });

  test('bounded share registry refuses a new link without deleting an existing one', async () => {
    process.env.HOI4_SHARED_ANALYSES_LIMIT = '1';
    shares = new SharedAnalysesService(results);
    await results.save(hash('a'), result);
    await results.save(hash('b'), result);
    const first = await shares.create(hash('a'));
    await expect(shares.create(hash('b'))).rejects.toBeInstanceOf(
      SharedAnalysisLimitError,
    );
    expect(await shares.getResult(first!.id)).toEqual(result);
  });

  test('failed atomic replacement keeps the previous public link usable', async () => {
    await results.save(hash('a'), result);
    const first = await shares.create(hash('a'));
    const rename = files.rename;
    const failure = jest
      .spyOn(files, 'rename')
      .mockImplementation((from, to) =>
        to === shareFile
          ? Promise.reject(new Error('private share path'))
          : rename(from, to),
      );
    await expect(shares.revokeByHash(hash('a'))).rejects.toThrow();
    expect(await shares.getResult(first!.id)).toEqual(result);
    failure.mockRestore();
    expect(await shares.revokeByHash(hash('a'))).toBe(true);
  });
});
