import type { QueryResult } from 'pg';
import {
  DatabaseService,
  DatabaseUnavailableError,
} from '../database/database.service';
import { AnalysisOwnershipRepository } from './analysis-ownership.repository';
import { AnalysisOwnershipService } from './analysis-ownership.service';

function result<Row extends Record<string, unknown>>(
  rows: Row[],
): QueryResult<Row> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    rows,
    fields: [],
  };
}

describe('analysis ownership repository and service', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const hash = 'a'.repeat(64);
  let database: { query: jest.Mock };
  let repository: AnalysisOwnershipRepository;
  let service: AnalysisOwnershipService;

  beforeEach(() => {
    database = { query: jest.fn() };
    repository = new AnalysisOwnershipRepository(
      database as unknown as DatabaseService,
    );
    service = new AnalysisOwnershipService(repository);
  });

  test('creates ownership idempotently with normalized analysis identity', async () => {
    database.query.mockResolvedValue(result([]));

    await expect(
      service.ensureOwnership(userId, hash.toUpperCase()),
    ).resolves.toBeUndefined();

    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (user_id, analysis_hash) DO UPDATE'),
      [userId, hash, null, null],
    );
  });

  test('stores sanitized per-user display metadata without changing hash identity', async () => {
    database.query.mockResolvedValue(result([]));
    const analyzedAt = new Date('2026-02-03T04:05:06.000Z');

    await service.ensureOwnership(userId, hash, {
      fileName: '../private/path/save.hoi4',
      analyzedAt,
    });

    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('file_name = COALESCE'),
      [userId, hash, 'save.hoi4', analyzedAt],
    );
  });

  test('checks ownership without exposing database row shapes', async () => {
    database.query
      .mockResolvedValueOnce(result([{ owned: true }]))
      .mockResolvedValueOnce(result([{ owned: false }]));

    await expect(service.hasOwnership(userId, hash)).resolves.toBe(true);
    await expect(service.hasOwnership(userId, 'b'.repeat(64))).resolves.toBe(
      false,
    );
    expect(database.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WHERE user_id = $1 AND analysis_hash = $2'),
      [userId, hash],
    );
  });

  test.each(['', 'short', 'g'.repeat(64), '../artifact'])(
    'rejects malformed hash %p before a database query',
    async (invalid) => {
      await expect(service.ensureOwnership(userId, invalid)).rejects.toThrow(
        TypeError,
      );
      await expect(service.hasOwnership(userId, invalid)).rejects.toThrow(
        TypeError,
      );
      expect(database.query).not.toHaveBeenCalled();
    },
  );

  test('fails closed when PostgreSQL ownership metadata is unavailable', async () => {
    database.query.mockRejectedValue(new DatabaseUnavailableError());

    await expect(service.ensureOwnership(userId, hash)).rejects.toBeInstanceOf(
      DatabaseUnavailableError,
    );
    await expect(service.hasOwnership(userId, hash)).rejects.toBeInstanceOf(
      DatabaseUnavailableError,
    );
  });

  test('uses bulk ownership queries and keeps pin/removal scoped to one user', async () => {
    const other = 'b'.repeat(64);
    database.query
      .mockResolvedValueOnce(
        result([
          {
            analysisHash: hash,
            pinned: true,
            fileName: 'mine.hoi4',
            analyzedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ]),
      )
      .mockResolvedValueOnce(result([{ analysisHash: hash }]))
      .mockResolvedValueOnce(result([{ analysisHash: hash }]))
      .mockResolvedValueOnce(result([{ analysisHash: hash }]))
      .mockResolvedValueOnce(result([{ analysisHash: other }]));

    await expect(service.listForUser(userId)).resolves.toEqual([
      {
        analysisHash: hash,
        pinned: true,
        fileName: 'mine.hoi4',
        analyzedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await expect(service.ownedHashes(userId, [hash, other])).resolves.toEqual(
      new Set([hash]),
    );
    await expect(service.setPinned(userId, hash, false)).resolves.toBe(true);
    await expect(service.remove(userId, [hash])).resolves.toEqual([hash]);
    await expect(service.pinnedHashes([hash, other])).resolves.toEqual(
      new Set([other]),
    );

    expect(database.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('analysis_hash = ANY($2::text[])'),
      [userId, [hash, other]],
    );
  });

  test('checks multiple required hashes in one query', async () => {
    const other = 'b'.repeat(64);
    database.query.mockResolvedValueOnce(
      result([{ analysisHash: hash }, { analysisHash: other }]),
    );

    await expect(service.hasAllOwnership(userId, [hash, other])).resolves.toBe(
      true,
    );
    expect(database.query).toHaveBeenCalledTimes(1);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('analysis_hash = ANY($2::text[])'),
      [userId, [hash, other]],
    );
  });

  test('loads all distinct owned hashes with one bulk query', async () => {
    const other = 'b'.repeat(64);
    database.query.mockResolvedValueOnce(
      result([{ analysisHash: hash }, { analysisHash: other }]),
    );

    await expect(service.listAllOwnedHashes()).resolves.toEqual(
      new Set([hash, other]),
    );
    expect(database.query).toHaveBeenCalledTimes(1);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT DISTINCT analysis_hash'),
    );
  });
});
