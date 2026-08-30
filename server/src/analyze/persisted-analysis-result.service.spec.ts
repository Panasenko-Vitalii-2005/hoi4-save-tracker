import { Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import files from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { analyzeSave, type AnalyzeResult } from '../hoi4/hoi4-parser';
import {
  PersistedAnalysisResultService,
  type PersistedAnalysisResultV1,
  type PersistedAnalysisResultV2,
} from './persisted-analysis-result.service';

const compress = promisify(gzip);
const decompress = promisify(gunzip);
const hash = (name: string) => createHash('sha256').update(name).digest('hex');

describe('PersistedAnalysisResultService', () => {
  const originalDirectory = process.env.HOI4_ANALYSIS_RESULTS_DIR;
  const originalLimit = process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES;
  let directory: string;
  let storage: string;
  let service: PersistedAnalysisResultService;
  let result: AnalyzeResult;
  let warn: jest.SpyInstance;
  const path = (key = hash('a')) => join(storage, `${key}.json.gz`);
  const references = () => [
    { hash: hash('a'), analyzedAt: '2026-08-03T00:00:00Z' },
    { hash: hash('b'), analyzedAt: '2026-08-01T00:00:00Z' },
    { hash: hash('c'), analyzedAt: '2026-08-02T00:00:00Z' },
  ];

  beforeEach(async () => {
    directory = await files.mkdtemp(join(tmpdir(), 'hoi4-result-'));
    storage = join(directory, 'results');
    process.env.HOI4_ANALYSIS_RESULTS_DIR = storage;
    delete process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES;
    const save = join(directory, 'fixture.hoi4');
    await files.writeFile(save, 'HOI4txt\ndate="1944.5.1.2"\ncountries={}');
    result = analyzeSave(save);
    service = new PersistedAnalysisResultService();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await files.rm(directory, { recursive: true, force: true });
    if (originalDirectory === undefined)
      delete process.env.HOI4_ANALYSIS_RESULTS_DIR;
    else process.env.HOI4_ANALYSIS_RESULTS_DIR = originalDirectory;
    if (originalLimit === undefined)
      delete process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES;
    else process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = originalLimit;
  });

  test('round-trips the full result including original parse_seconds and Unicode after recreation', async () => {
    result.game_date = 'Möwe / ARM Potosí / NRB Marcílio Dias';
    expect(await service.save(hash('a'), result)).toBe(true);
    expect(await new PersistedAnalysisResultService().get(hash('a'))).toEqual(
      result,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  test('writes a gzip UTF-8 versioned envelope with exact hash and timestamp', async () => {
    await service.save(hash('a'), result);
    const bytes = await files.readFile(path());
    expect([...bytes.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
    const envelope = JSON.parse(
      (await decompress(bytes)).toString('utf8'),
    ) as PersistedAnalysisResultV2;
    expect(envelope).toEqual({
      formatVersion: 2,
      hash: hash('a'),
      savedAt: expect.any(String) as unknown,
      comparisonContext: { campaignId: null, gameVersion: null },
      result,
    });
    expect(Number.isFinite(Date.parse(envelope.savedAt))).toBe(true);
    expect(bytes.length).toBeLessThan(
      Buffer.byteLength(JSON.stringify(envelope)),
    );
  });

  test.each([
    ['wrong hash', { hash: hash('b') }],
    ['unsupported version', { formatVersion: 3 }],
    ['missing version', { formatVersion: undefined }],
    ['invalid timestamp', { savedAt: 'not a date' }],
    ['invalid result', { result: { game_date: '1944.5.1' } }],
  ])(
    'rejects %s without exposing details or repeated warnings',
    async (_name, change) => {
      await service.save(hash('a'), result);
      const original = JSON.parse(
        (await decompress(await files.readFile(path()))).toString('utf8'),
      ) as PersistedAnalysisResultV2;
      await files.writeFile(
        path(),
        await compress(JSON.stringify({ ...original, ...change })),
      );
      expect(await service.get(hash('a'))).toBeNull();
      expect(await service.get(hash('a'))).toBeNull();
      expect(await service.exists(hash('a'))).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(directory);
    },
  );

  test('round-trips comparison context and reads legacy v1 as unknown', async () => {
    const comparisonContext = {
      campaignId: '0731c3c7-035e-46b1-b07b-6c35b27e8dc2',
      gameVersion: 'Operation Postern v1.19.2.0.a729 (d245)',
    };
    await service.save(hash('a'), result, [], { comparisonContext });
    expect(await service.getWithContext(hash('a'))).toEqual({
      result,
      comparisonContext,
    });

    const legacy: PersistedAnalysisResultV1 = {
      formatVersion: 1,
      hash: hash('a'),
      savedAt: new Date().toISOString(),
      result,
    };
    await files.writeFile(path(), await compress(JSON.stringify(legacy)));
    expect(
      await new PersistedAnalysisResultService().getWithContext(hash('a')),
    ).toEqual({
      result,
      comparisonContext: { campaignId: null, gameVersion: null },
    });
  });

  test.each(['gzip', 'json', 'truncated'])(
    'handles corrupt %s safely',
    async (kind) => {
      await service.save(hash('a'), result);
      const bytes =
        kind === 'gzip'
          ? Buffer.from('not gzip')
          : kind === 'json'
            ? await compress('{bad JSON')
            : (await files.readFile(path())).subarray(0, 20);
      await files.writeFile(path(), bytes);
      expect(await service.get(hash('a'))).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(await service.save(hash('a'), result)).toBe(true);
      expect(await service.get(hash('a'))).toEqual(result);
    },
  );

  test('missing directory and missing file quietly return unavailable', async () => {
    expect(await service.get(hash('a'))).toBeNull();
    expect(await service.exists(hash('a'))).toBe(false);
    await files.mkdir(storage);
    expect(await service.get(hash('a'))).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  test('normalizes uppercase hashes to one validated filename', async () => {
    await service.save(hash('a').toUpperCase(), result);
    expect(await service.get(hash('a').toUpperCase())).toEqual(result);
    expect(await files.readdir(storage)).toEqual([`${hash('a')}.json.gz`]);
  });

  test.each([
    '../../secret',
    '..\\secret',
    '/tmp/file',
    'a'.repeat(63),
    'g'.repeat(64),
    `${hash('a')}\n`,
  ])('rejects unsafe hash %j before filesystem access', async (key) => {
    await expect(service.get(key)).rejects.toThrow('Invalid analysis hash');
    await expect(service.save(key, result)).rejects.toThrow(
      'Invalid analysis hash',
    );
    await expect(service.exists(key)).rejects.toThrow('Invalid analysis hash');
    expect(() => service.delete(key)).toThrow('Invalid analysis hash');
    expect(await files.readdir(directory)).toEqual(['fixture.hoi4']);
  });

  test('atomically replaces the same hash without duplicate files', async () => {
    await service.save(hash('a'), result);
    const replacement = { ...result, parse_seconds: 42 };
    await service.save(hash('a'), replacement);
    expect(await service.get(hash('a'))).toEqual(replacement);
    expect(await files.readdir(storage)).toEqual([`${hash('a')}.json.gz`]);
  });

  test('failed rename preserves old bytes, cleans its temporary file and permits recovery', async () => {
    await service.save(hash('a'), result);
    const before = await files.readFile(path());
    const replace = jest
      .spyOn(files, 'rename')
      .mockRejectedValue(new Error('Private path denied'));
    expect(
      await service.save(hash('a'), { ...result, parse_seconds: 999 }),
    ).toBe(false);
    expect(await files.readFile(path())).toEqual(before);
    expect(await files.readdir(storage)).toEqual([`${hash('a')}.json.gz`]);
    replace.mockRestore();
    expect(await service.save(hash('a'), result)).toBe(true);
  });

  test('delete is idempotent and affects only the requested result', async () => {
    await service.save(hash('a'), result);
    await service.save(hash('b'), result);
    await service.delete(hash('a'));
    await service.delete(hash('a'));
    expect(await service.exists(hash('a'))).toBe(false);
    expect(await service.exists(hash('b'))).toBe(true);
  });

  test('byte quota evicts oldest analysis timestamp rather than file creation order', async () => {
    await service.save(hash('a'), result);
    await service.save(hash('b'), result);
    const size = (await files.stat(path())).size;
    process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = String(size * 2 + 100);
    service = new PersistedAnalysisResultService();
    expect(await service.save(hash('c'), result, references())).toBe(true);
    expect(await service.exists(hash('a'))).toBe(true);
    expect(await service.exists(hash('b'))).toBe(false);
    expect(await service.exists(hash('c'))).toBe(true);
    const sizes = await Promise.all(
      (await files.readdir(storage)).map(
        async (file) => (await files.stat(join(storage, file))).size,
      ),
    );
    expect(sizes.reduce((sum, bytes) => sum + bytes, 0)).toBeLessThanOrEqual(
      size * 2 + 100,
    );
  });

  test('lowered byte quota is enforced during startup reconciliation', async () => {
    await service.save(hash('a'), result);
    await service.save(hash('b'), result);
    const size = (await files.stat(path())).size;
    process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = String(size + 100);
    const available = await new PersistedAnalysisResultService().reconcile(
      references(),
    );
    expect([...available]).toEqual([hash('a')]);
  });

  test('one result above the quota is declined without a file', async () => {
    process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = '1';
    service = new PersistedAnalysisResultService();
    expect(await service.save(hash('a'), result)).toBe(false);
    expect(await service.exists(hash('a'))).toBe(false);
  });

  test.each(['', '0', '-1', '1.5', 'invalid', 'Infinity', '9007199254740992'])(
    'invalid quota %j falls back to the bounded default',
    async (limit) => {
      process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = limit;
      service = new PersistedAnalysisResultService();
      expect(service['maxBytes']).toBe(128 * 1024 * 1024);
      expect(await service.save(hash('a'), result)).toBe(true);
    },
  );

  test('reconciliation removes only managed orphan and temporary files', async () => {
    await service.save(hash('a'), result);
    await service.save(hash('b'), result);
    await files.writeFile(`${path()}.${randomUUID()}.tmp`, 'incomplete');
    await files.writeFile(join(storage, 'unrelated.txt'), 'keep');
    expect([...(await service.reconcile([references()[0]]))]).toEqual([
      hash('a'),
    ]);
    expect((await files.readdir(storage)).sort()).toEqual(
      [`${hash('a')}.json.gz`, 'unrelated.txt'].sort(),
    );
  });

  test('does not delete or overwrite a directory masquerading as a result file', async () => {
    await files.mkdir(path(), { recursive: true });
    expect(await service.save(hash('a'), result)).toBe(false);
    expect(await service.get(hash('a'))).toBeNull();
    await expect(service.delete(hash('a'))).rejects.toThrow(
      'Unsafe result deletion',
    );
    expect((await files.stat(path())).isDirectory()).toBe(true);
  });

  test('disk eviction protects an older pinned result over a newer unpinned one', async () => {
    await service.save(hash('a'), result);
    await service.save(hash('b'), result);
    const size = (await files.stat(path())).size;
    process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = String(size * 2 + 100);
    service = new PersistedAnalysisResultService();
    const refs = [
      { hash: hash('a'), analyzedAt: '2026-08-01T00:00:00Z', pinned: true },
      { hash: hash('b'), analyzedAt: '2026-08-02T00:00:00Z', pinned: false },
      { hash: hash('c'), analyzedAt: '2026-08-03T00:00:00Z', pinned: false },
    ];
    expect(await service.save(hash('c'), result, refs)).toBe(true);
    expect(await service.exists(hash('a'))).toBe(true);
    expect(await service.exists(hash('b'))).toBe(false);
    expect(await service.exists(hash('c'))).toBe(true);
  });

  test('a new unpinned result is declined rather than displacing pins under a hard byte limit', async () => {
    await service.save(hash('a'), result);
    const size = (await files.stat(path())).size;
    process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = String(size + 100);
    service = new PersistedAnalysisResultService();
    expect(
      await service.save(hash('b'), result, [
        { hash: hash('a'), analyzedAt: '2026-08-01T00:00:00Z', pinned: true },
        { hash: hash('b'), analyzedAt: '2026-08-02T00:00:00Z', pinned: false },
      ]),
    ).toBe(false);
    expect(await service.get(hash('a'))).toEqual(result);
    expect(await service.exists(hash('b'))).toBe(false);
  });

  test('newer pinned result can replace oldest pin when all results are pinned', async () => {
    await service.save(hash('a'), result);
    const size = (await files.stat(path())).size;
    process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = String(size + 100);
    service = new PersistedAnalysisResultService();
    expect(
      await service.save(hash('b'), result, [
        { hash: hash('a'), analyzedAt: '2026-08-01T00:00:00Z', pinned: true },
        { hash: hash('b'), analyzedAt: '2026-08-02T00:00:00Z', pinned: true },
      ]),
    ).toBe(true);
    expect(await service.exists(hash('a'))).toBe(false);
    expect(await service.exists(hash('b'))).toBe(true);
  });
});
