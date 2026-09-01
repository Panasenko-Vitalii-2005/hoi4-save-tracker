import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import files from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeSave, type AnalyzeResult } from '../hoi4/hoi4-parser';
import { RecentAnalysesService } from './recent-analyses.service';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';

describe('RecentAnalysesService', () => {
  const originalFile = process.env.HOI4_RECENT_ANALYSES_FILE;
  const originalLimit = process.env.HOI4_RECENT_ANALYSES_LIMIT;
  const originalResults = process.env.HOI4_ANALYSIS_RESULTS_DIR;
  const originalBytes = process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES;
  let directory: string;
  let file: string;
  let result: AnalyzeResult;
  let history: RecentAnalysesService;
  let results: PersistedAnalysisResultService;
  let warn: jest.SpyInstance;
  const input = (name: string, fileName = `${name}.hoi4`) => ({
    hash: createHash('sha256').update(name).digest('hex'),
    fileName,
    fileSizeBytes: 100,
  });
  const rewriteStoredItem = async (
    hash: string,
    update: (item: Record<string, unknown>) => void,
  ) => {
    const stored = JSON.parse(await files.readFile(file, 'utf8')) as {
      items: Record<string, unknown>[];
    };
    const item = stored.items.find((entry) => entry.hash === hash);
    if (!item) throw new Error('Missing stored test item');
    update(item);
    await files.writeFile(file, JSON.stringify(stored));
  };

  beforeEach(async () => {
    directory = await files.mkdtemp(join(tmpdir(), 'hoi4-recent-'));
    file = join(directory, 'data', 'recent.json');
    process.env.HOI4_RECENT_ANALYSES_FILE = file;
    process.env.HOI4_ANALYSIS_RESULTS_DIR = join(directory, 'results');
    delete process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES;
    delete process.env.HOI4_RECENT_ANALYSES_LIMIT;
    const save = join(directory, 'fixture.hoi4');
    await files.writeFile(save, 'HOI4txt\ndate="1944.5.1.2"\ncountries={}');
    result = analyzeSave(save);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    results = new PersistedAnalysisResultService();
    history = new RecentAnalysesService(results);
    await history.list();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await files.rm(directory, { recursive: true, force: true });
    if (originalFile === undefined)
      delete process.env.HOI4_RECENT_ANALYSES_FILE;
    else process.env.HOI4_RECENT_ANALYSES_FILE = originalFile;
    if (originalLimit === undefined)
      delete process.env.HOI4_RECENT_ANALYSES_LIMIT;
    else process.env.HOI4_RECENT_ANALYSES_LIMIT = originalLimit;
    if (originalResults === undefined)
      delete process.env.HOI4_ANALYSIS_RESULTS_DIR;
    else process.env.HOI4_ANALYSIS_RESULTS_DIR = originalResults;
    if (originalBytes === undefined)
      delete process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES;
    else process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = originalBytes;
  });

  test('starts quietly empty when no persistence file exists', async () => {
    expect(await history.list()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  test('persists only whitelisted metadata and reloads it after recreation', async () => {
    await history.record(
      input('a', 'C:\\private\\upload\\original.hoi4'),
      result,
    );
    const items = await history.list();
    expect(items).toEqual([
      {
        ...input('a', 'original.hoi4'),
        analyzedAt: expect.any(String) as unknown,
        gameDate: '1944.5.1',
        countryCount: 0,
        divisionCount: 0,
        shipCount: 0,
        navalLossCount: 0,
        manpowerInField: 0,
        aircraftCount: 0,
        hasPersistedResult: true,
        pinned: false,
      },
    ]);
    expect(new Date(items[0].analyzedAt).toISOString()).toBe(
      items[0].analyzedAt,
    );
    const stored = await files.readFile(file, 'utf8');
    expect(JSON.parse(stored)).toEqual({ items });
    expect(stored).not.toMatch(
      /private|upload|sourceOffset|parse_seconds|by_country|navalLosses|worker|stack|HOI4txt/,
    );
    expect(
      await new RecentAnalysesService(
        new PersistedAnalysisResultService(),
      ).list(),
    ).toEqual(items);
    expect(
      await new RecentAnalysesService(
        new PersistedAnalysisResultService(),
      ).getResult(input('a').hash),
    ).toEqual(result);
    expect(await files.readdir(join(directory, 'data'))).toEqual([
      'recent.json',
    ]);
  });

  test('records manpower and aircraft from existing AnalyzeResult totals', async () => {
    await history.record(input('metrics'), {
      ...result,
      totals: {
        ...result.totals,
        manpowerInField: 31_378_714,
        aircraft: 53_095,
      },
    });
    expect((await history.list())[0]).toMatchObject({
      manpowerInField: 31_378_714,
      aircraftCount: 53_095,
    });
  });

  test('persists comparison context separately from recent metadata', async () => {
    const comparisonContext = {
      campaignId: '0731c3c7-035e-46b1-b07b-6c35b27e8dc2',
      gameVersion: '1.19.2',
    };
    await history.record(
      input('comparison-context'),
      result,
      comparisonContext,
    );
    expect(
      await results.getWithContext(input('comparison-context').hash),
    ).toEqual({
      result,
      comparisonContext,
    });
    expect(await files.readFile(file, 'utf8')).not.toMatch(
      /campaignId|gameVersion|0731c3c7/,
    );
  });

  test('backfills both missing legacy metrics from the persisted result and persists them', async () => {
    const metrics = {
      ...result,
      totals: {
        ...result.totals,
        manpowerInField: 31_378_714,
        aircraft: 53_095,
      },
    };
    await history.record(input('legacy-both'), metrics);
    await rewriteStoredItem(input('legacy-both').hash, (item) => {
      delete item.manpowerInField;
      delete item.aircraftCount;
    });
    const get = jest.spyOn(results, 'get');

    history = new RecentAnalysesService(results);
    expect((await history.list())[0]).toMatchObject({
      manpowerInField: 31_378_714,
      aircraftCount: 53_095,
    });
    expect(get).toHaveBeenCalledTimes(1);

    history = new RecentAnalysesService(results);
    expect((await history.list())[0]).toMatchObject({
      manpowerInField: 31_378_714,
      aircraftCount: 53_095,
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  test('backfills only missing manpower and preserves existing aircraft metadata', async () => {
    await history.record(input('legacy-manpower'), {
      ...result,
      totals: {
        ...result.totals,
        manpowerInField: 8_786_707,
        aircraft: 9_526,
      },
    });
    await rewriteStoredItem(input('legacy-manpower').hash, (item) => {
      delete item.manpowerInField;
      item.aircraftCount = 123;
    });

    history = new RecentAnalysesService(results);
    expect((await history.list())[0]).toMatchObject({
      manpowerInField: 8_786_707,
      aircraftCount: 123,
    });
  });

  test('backfills only missing aircraft and preserves existing manpower metadata', async () => {
    await history.record(input('legacy-aircraft'), {
      ...result,
      totals: {
        ...result.totals,
        manpowerInField: 8_308_467,
        aircraft: 9_077,
      },
    });
    await rewriteStoredItem(input('legacy-aircraft').hash, (item) => {
      item.manpowerInField = 456;
      delete item.aircraftCount;
    });

    history = new RecentAnalysesService(results);
    expect((await history.list())[0]).toMatchObject({
      manpowerInField: 456,
      aircraftCount: 9_077,
    });
  });

  test('missing persisted result leaves legacy metrics unavailable without failing', async () => {
    await history.record(input('legacy-missing'), result);
    await rewriteStoredItem(input('legacy-missing').hash, (item) => {
      delete item.manpowerInField;
      delete item.aircraftCount;
    });
    await results.delete(input('legacy-missing').hash);
    const get = jest.spyOn(results, 'get');

    history = new RecentAnalysesService(results);
    await expect(history.list()).resolves.toEqual([
      expect.objectContaining({
        manpowerInField: null,
        aircraftCount: null,
        hasPersistedResult: false,
      }),
    ]);
    expect(get).not.toHaveBeenCalled();
  });

  test('corrupt persisted result leaves legacy metrics unavailable without failing', async () => {
    await history.record(input('legacy-corrupt'), result);
    await rewriteStoredItem(input('legacy-corrupt').hash, (item) => {
      delete item.manpowerInField;
      delete item.aircraftCount;
    });
    await files.writeFile(
      join(directory, 'results', `${input('legacy-corrupt').hash}.json.gz`),
      'corrupt',
    );

    history = new RecentAnalysesService(results);
    await expect(history.list()).resolves.toEqual([
      expect.objectContaining({
        manpowerInField: null,
        aircraftCount: null,
        hasPersistedResult: false,
      }),
    ]);
  });

  test('incompatible non-finite persisted metrics remain unavailable', async () => {
    await history.record(input('legacy-incompatible'), result);
    await rewriteStoredItem(input('legacy-incompatible').hash, (item) => {
      delete item.manpowerInField;
      delete item.aircraftCount;
    });
    jest.spyOn(results, 'get').mockResolvedValue({
      ...result,
      totals: {
        ...result.totals,
        manpowerInField: Number.NaN,
        aircraft: Number.POSITIVE_INFINITY,
      },
    });

    history = new RecentAnalysesService(results);
    await expect(history.list()).resolves.toEqual([
      expect.objectContaining({
        manpowerInField: null,
        aircraftCount: null,
      }),
    ]);
  });

  test('finite zero is backfilled as a valid metric value', async () => {
    await history.record(input('legacy-zero'), result);
    await rewriteStoredItem(input('legacy-zero').hash, (item) => {
      delete item.manpowerInField;
      delete item.aircraftCount;
    });

    history = new RecentAnalysesService(results);
    expect((await history.list())[0]).toMatchObject({
      manpowerInField: 0,
      aircraftCount: 0,
    });
  });

  test('backfill uses only persisted results and does not repeatedly reload a successful migration', async () => {
    await history.record(input('legacy-direct'), result);
    await rewriteStoredItem(input('legacy-direct').hash, (item) => {
      delete item.manpowerInField;
      delete item.aircraftCount;
    });
    const get = jest.spyOn(results, 'get');

    history = new RecentAnalysesService(results);
    await history.list();
    await history.list();

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(input('legacy-direct').hash);
  });

  test('same hash updates name, timestamp, stats and recency without duplicates', async () => {
    const now = jest
      .spyOn(Date.prototype, 'toISOString')
      .mockReturnValue('2026-08-01T00:00:00.000Z');
    await history.record(input('a'), result);
    await history.record(input('b'), result);
    now.mockReturnValue('2026-08-02T00:00:00.000Z');
    await history.record(input('a', 'renamed.hoi4'), {
      ...result,
      active_countries: 12,
    });
    const items = await history.list();
    expect(items.map((item) => item.hash)).toEqual([
      input('a').hash,
      input('b').hash,
    ]);
    expect(items[0]).toMatchObject({
      fileName: 'renamed.hoi4',
      analyzedAt: '2026-08-02T00:00:00.000Z',
      countryCount: 12,
    });
  });

  test('different hashes with the same filename remain separate', async () => {
    await history.record(input('a', 'autosave.hoi4'), result);
    await history.record(input('b', 'autosave.hoi4'), result);
    expect((await history.list()).map((item) => item.hash)).toEqual([
      input('b').hash,
      input('a').hash,
    ]);
  });

  test('configured limit keeps newest entries, also on reload', async () => {
    process.env.HOI4_RECENT_ANALYSES_LIMIT = '2';
    history = new RecentAnalysesService(results);
    for (const name of ['a', 'b', 'c'])
      await history.record(input(name), result);
    expect((await history.list()).map((item) => item.hash)).toEqual([
      input('c').hash,
      input('b').hash,
    ]);
    process.env.HOI4_RECENT_ANALYSES_LIMIT = '1';
    expect(await results.exists(input('a').hash)).toBe(false);
    expect(await new RecentAnalysesService(results).list()).toHaveLength(1);
    expect(await results.exists(input('b').hash)).toBe(false);
  });

  test('uses a batch-capable bounded default of 200', async () => {
    history = new RecentAnalysesService(results);
    expect(history['limit']).toBe(200);
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        history.record(input(String(i)), result),
      ),
    );
    const items = await history.list();
    expect(items).toHaveLength(40);
    expect(items[0].hash).toBe(input('39').hash);
    expect(items[39].hash).toBe(input('0').hash);
  });

  test.each(['', '0', '-1', '1.5', 'abc', 'Infinity'])(
    'falls back to the 200-item default for invalid limit %j',
    (limit) => {
      process.env.HOI4_RECENT_ANALYSES_LIMIT = limit;
      history = new RecentAnalysesService(results);
      expect(history['limit']).toBe(200);
    },
  );

  test.each(['{broken', '{"items":{}}', '{"items":[null]}'])(
    'corrupt history %s falls back to empty, warns once and can recover',
    async (contents) => {
      await files.mkdir(join(directory, 'data'));
      await files.writeFile(file, contents);
      history = new RecentAnalysesService(results);
      expect(await history.list()).toEqual([]);
      expect(await history.list()).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      await history.record(input('a'), result);
      expect(await new RecentAnalysesService(results).list()).toHaveLength(1);
    },
  );

  test('loaded objects are whitelisted and returned lists cannot mutate store state', async () => {
    await history.record(input('a'), result);
    const item = (await history.list())[0];
    await files.writeFile(
      file,
      JSON.stringify({ items: [{ ...item, temporaryPath: 'SECRET', result }] }),
    );
    history = new RecentAnalysesService(results);
    const items = await history.list();
    expect(items[0]).toEqual(item);
    items[0].fileName = 'mutated';
    items.length = 0;
    expect(await history.list()).toEqual([item]);
  });

  test('concurrent updates serialize without losing entries', async () => {
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((name) => history.record(input(name), result)),
    );
    const items = await history.list();
    expect(items.map((item) => item.hash)).toEqual(
      ['d', 'c', 'b', 'a'].map((name) => input(name).hash),
    );
    expect(await new RecentAnalysesService(results).list()).toEqual(items);
  });

  test('failed atomic replacement leaves old store intact and does not poison later writes', async () => {
    await history.record(input('a'), result);
    const before = await files.readFile(file, 'utf8');
    const rename = files.rename;
    const replace = jest
      .spyOn(files, 'rename')
      .mockImplementation((from, to) =>
        to === file
          ? Promise.reject(new Error('Disk unavailable'))
          : rename(from, to),
      );
    await expect(history.record(input('b'), result)).resolves.toBeUndefined();
    await history.record(input('c'), result);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await files.readFile(file, 'utf8')).toBe(before);
    expect(await files.readdir(join(directory, 'results'))).toEqual([
      `${input('a').hash}.json.gz`,
    ]);
    expect(await files.readdir(join(directory, 'data'))).toEqual([
      'recent.json',
    ]);
    replace.mockRestore();
    await history.record(input('d'), result);
    expect((await history.list()).map((item) => item.hash)).toEqual([
      input('d').hash,
      input('a').hash,
    ]);
  });

  test('clear persists an empty history and subsequent analysis can add metadata', async () => {
    await history.record(input('a'), result);
    await history.clear();
    expect(await new RecentAnalysesService(results).list()).toEqual([]);
    expect(await files.readdir(join(directory, 'results'))).toEqual([]);
    await history.record(input('b'), result);
    expect(await history.list()).toHaveLength(1);
  });

  test('legacy metadata stays visible without Open until re-analysis', async () => {
    await history.record(input('a'), result);
    const legacy = { ...(await history.list())[0] } as Record<string, unknown>;
    delete legacy.hasPersistedResult;
    delete legacy.pinned;
    delete legacy.manpowerInField;
    delete legacy.aircraftCount;
    await results.delete(input('a').hash);
    await files.writeFile(file, JSON.stringify({ items: [legacy] }));
    history = new RecentAnalysesService(results);
    expect((await history.list())[0]).toMatchObject({
      hash: input('a').hash,
      hasPersistedResult: false,
      pinned: false,
      manpowerInField: null,
      aircraftCount: null,
    });
    expect(await history.getResult(input('a').hash)).toBeNull();
    await history.record(input('a'), result);
    expect((await history.list())[0].hasPersistedResult).toBe(true);
  });

  test('missing results reconcile on load and list without removing metadata', async () => {
    await history.record(input('a'), result);
    await history.record(input('b'), result);
    await results.delete(input('a').hash);
    history = new RecentAnalysesService(results);
    expect(
      (await history.list()).find((item) => item.hash === input('a').hash)
        ?.hasPersistedResult,
    ).toBe(false);
    await results.delete(input('b').hash);
    expect(
      (await history.list()).every((item) => !item.hasPersistedResult),
    ).toBe(true);
    expect(await history.list()).toHaveLength(2);
  });

  test('corrupt result becomes unavailable and metadata remains false after restart', async () => {
    await history.record(input('a'), result);
    await files.writeFile(
      join(directory, 'results', `${input('a').hash}.json.gz`),
      'corrupt',
    );
    expect(await history.getResult(input('a').hash)).toBeNull();
    expect((await history.list())[0].hasPersistedResult).toBe(false);
    expect(
      (
        await new RecentAnalysesService(
          new PersistedAnalysisResultService(),
        ).list()
      )[0].hasPersistedResult,
    ).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('byte eviction masks availability but retains recent metadata', async () => {
    await history.record(input('a'), result);
    const size = (
      await files.stat(join(directory, 'results', `${input('a').hash}.json.gz`))
    ).size;
    process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = String(size + 100);
    results = new PersistedAnalysisResultService();
    history = new RecentAnalysesService(results);
    await history.record(input('b'), result);
    expect(
      (await history.list()).map((item) => item.hasPersistedResult),
    ).toEqual([true, false]);
    expect(await results.exists(input('a').hash)).toBe(false);
  });

  test('unavailable result directory does not prevent recording metadata with false availability', async () => {
    await files.writeFile(join(directory, 'results'), 'not a directory');
    await expect(history.record(input('a'), result)).resolves.toBeUndefined();
    expect(await history.list()).toEqual([
      expect.objectContaining({
        hash: input('a').hash,
        hasPersistedResult: false,
      }),
    ]);
  });

  test('delete removes only the chosen metadata and result, is idempotent, and survives restart', async () => {
    await history.record(input('a'), result);
    await history.record(input('b'), result);
    await history.setPinned(input('a').hash, true);
    await history.delete(input('a').hash);
    await history.delete(input('a').hash);
    expect(await results.exists(input('a').hash)).toBe(false);
    expect(await results.get(input('b').hash)).toEqual(result);
    expect(
      (await new RecentAnalysesService(results).list()).map(
        (item) => item.hash,
      ),
    ).toEqual([input('b').hash]);
  });

  test('pin and unpin persist without changing analysis time or result', async () => {
    await history.record(input('a'), result);
    const before = (await history.list())[0];
    expect(await history.setPinned(input('a').hash, true)).toBe(true);
    history = new RecentAnalysesService(results);
    expect((await history.list())[0]).toEqual({ ...before, pinned: true });
    expect(await history.getResult(input('a').hash)).toEqual(result);
    expect(await history.setPinned(input('a').hash, false)).toBe(true);
    expect((await new RecentAnalysesService(results).list())[0]).toEqual(
      before,
    );
    expect(await history.setPinned(input('missing').hash, true)).toBe(false);
  });

  test('count eviction protects old pins and deletes the oldest unpinned result', async () => {
    process.env.HOI4_RECENT_ANALYSES_LIMIT = '2';
    history = new RecentAnalysesService(results);
    await history.record(input('a'), result);
    await history.setPinned(input('a').hash, true);
    await history.record(input('b'), result);
    await history.record(input('c'), result);
    expect((await history.list()).map((item) => item.hash)).toEqual([
      input('a').hash,
      input('c').hash,
    ]);
    expect(await results.exists(input('b').hash)).toBe(false);
    expect(await results.exists(input('a').hash)).toBe(true);
  });

  test('all-pinned history stays bounded: new unpinned entries are omitted, lowering limit evicts oldest pin', async () => {
    process.env.HOI4_RECENT_ANALYSES_LIMIT = '2';
    history = new RecentAnalysesService(results);
    await history.record(input('a'), result);
    await history.setPinned(input('a').hash, true);
    await history.record(input('b'), result);
    await history.setPinned(input('b').hash, true);
    await history.record(input('c'), result);
    expect(await history.list()).toHaveLength(2);
    expect(await results.exists(input('c').hash)).toBe(false);
    process.env.HOI4_RECENT_ANALYSES_LIMIT = '1';
    history = new RecentAnalysesService(results);
    expect((await history.list()).map((item) => item.hash)).toEqual([
      input('b').hash,
    ]);
    expect(await results.exists(input('a').hash)).toBe(false);
  });

  test('same-hash refresh and queued pin/delete/record mutations use the latest state', async () => {
    await history.record(input('a'), result);
    await history.record(input('b'), result);
    await Promise.all([
      history.setPinned(input('a').hash, true),
      history.record(input('a', 'renamed.hoi4'), result),
      history.delete(input('b').hash),
      history.record(input('c'), result),
    ]);
    expect(
      (await history.list()).map(({ hash, pinned, fileName }) => ({
        hash,
        pinned,
        fileName,
      })),
    ).toEqual([
      { hash: input('a').hash, pinned: true, fileName: 'renamed.hoi4' },
      { hash: input('c').hash, pinned: false, fileName: 'c.hoi4' },
    ]);
    await Promise.all([history.clear(), history.record(input('d'), result)]);
    expect((await history.list()).map((item) => item.hash)).toEqual([
      input('d').hash,
    ]);
    expect(await results.exists(input('a').hash)).toBe(false);
    expect(await results.exists(input('c').hash)).toBe(false);
  });

  test('failed pin/delete metadata commit keeps entries and allows retry', async () => {
    await history.record(input('a'), result);
    const replace = jest
      .spyOn(files, 'rename')
      .mockRejectedValue(new Error('Storage unavailable'));
    await expect(history.setPinned(input('a').hash, true)).rejects.toThrow();
    expect((await history.list())[0].pinned).toBe(false);
    await expect(history.delete(input('a').hash)).rejects.toThrow();
    expect(await history.list()).toHaveLength(1);
    replace.mockRestore();
    await history.delete(input('a').hash);
    expect(await history.list()).toEqual([]);
  });

  test('pin-only disk overflow marks oldest pinned result unavailable without removing metadata', async () => {
    await history.record(input('a'), result);
    await history.setPinned(input('a').hash, true);
    await history.record(input('b'), result);
    await history.setPinned(input('b').hash, true);
    const size = (
      await files.stat(join(directory, 'results', `${input('b').hash}.json.gz`))
    ).size;
    process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = String(size + 100);
    results = new PersistedAnalysisResultService();
    history = new RecentAnalysesService(results);
    expect(
      (await history.list()).map(({ pinned, hasPersistedResult }) => [
        pinned,
        hasPersistedResult,
      ]),
    ).toEqual([
      [true, true],
      [true, false],
    ]);
    await history.clear();
    expect(await files.readdir(join(directory, 'results'))).toEqual([]);
  });
});
