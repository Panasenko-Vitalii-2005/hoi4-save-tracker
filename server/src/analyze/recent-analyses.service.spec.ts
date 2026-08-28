import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import files from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeSave, type AnalyzeResult } from '../hoi4/hoi4-parser';
import { RecentAnalysesService } from './recent-analyses.service';

describe('RecentAnalysesService', () => {
  const originalFile = process.env.HOI4_RECENT_ANALYSES_FILE;
  const originalLimit = process.env.HOI4_RECENT_ANALYSES_LIMIT;
  let directory: string;
  let file: string;
  let result: AnalyzeResult;
  let history: RecentAnalysesService;
  let warn: jest.SpyInstance;
  const input = (name: string, fileName = `${name}.hoi4`) => ({
    hash: createHash('sha256').update(name).digest('hex'),
    fileName,
    fileSizeBytes: 100,
  });

  beforeEach(async () => {
    directory = await files.mkdtemp(join(tmpdir(), 'hoi4-recent-'));
    file = join(directory, 'data', 'recent.json');
    process.env.HOI4_RECENT_ANALYSES_FILE = file;
    delete process.env.HOI4_RECENT_ANALYSES_LIMIT;
    const save = join(directory, 'fixture.hoi4');
    await files.writeFile(save, 'HOI4txt\ndate="1944.5.1.2"\ncountries={}');
    result = analyzeSave(save);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    history = new RecentAnalysesService();
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
    expect(await new RecentAnalysesService().list()).toEqual(items);
    expect(await files.readdir(join(directory, 'data'))).toEqual([
      'recent.json',
    ]);
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
    history = new RecentAnalysesService();
    for (const name of ['a', 'b', 'c'])
      await history.record(input(name), result);
    expect((await history.list()).map((item) => item.hash)).toEqual([
      input('c').hash,
      input('b').hash,
    ]);
    process.env.HOI4_RECENT_ANALYSES_LIMIT = '1';
    expect(await new RecentAnalysesService().list()).toHaveLength(1);
  });

  test.each([undefined, '', '0', '-1', '1.5', 'abc', 'Infinity'])(
    'uses bounded default 20 for missing/invalid limit %j',
    async (limit) => {
      if (limit !== undefined) process.env.HOI4_RECENT_ANALYSES_LIMIT = limit;
      history = new RecentAnalysesService();
      await Promise.all(
        Array.from({ length: 22 }, (_, i) =>
          history.record(input(String(i)), result),
        ),
      );
      const items = await history.list();
      expect(items).toHaveLength(20);
      expect(items[0].hash).toBe(input('21').hash);
      expect(items[19].hash).toBe(input('2').hash);
    },
  );

  test.each(['{broken', '{"items":{}}', '{"items":[null]}'])(
    'corrupt history %s falls back to empty, warns once and can recover',
    async (contents) => {
      await files.mkdir(join(directory, 'data'));
      await files.writeFile(file, contents);
      history = new RecentAnalysesService();
      expect(await history.list()).toEqual([]);
      expect(await history.list()).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      await history.record(input('a'), result);
      expect(await new RecentAnalysesService().list()).toHaveLength(1);
    },
  );

  test('loaded objects are whitelisted and returned lists cannot mutate store state', async () => {
    await history.record(input('a'), result);
    const item = (await history.list())[0];
    await files.writeFile(
      file,
      JSON.stringify({ items: [{ ...item, temporaryPath: 'SECRET', result }] }),
    );
    history = new RecentAnalysesService();
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
    expect(await new RecentAnalysesService().list()).toEqual(items);
  });

  test('failed atomic replacement leaves old store intact and does not poison later writes', async () => {
    await history.record(input('a'), result);
    const before = await files.readFile(file, 'utf8');
    const replace = jest
      .spyOn(files, 'rename')
      .mockRejectedValue(new Error('Disk unavailable'));
    await expect(history.record(input('b'), result)).resolves.toBeUndefined();
    await history.record(input('c'), result);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await files.readFile(file, 'utf8')).toBe(before);
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
    expect(await new RecentAnalysesService().list()).toEqual([]);
    await history.record(input('b'), result);
    expect(await history.list()).toHaveLength(1);
  });
});
