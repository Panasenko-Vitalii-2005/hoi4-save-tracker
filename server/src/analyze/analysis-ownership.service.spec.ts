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
      expect.stringContaining(
        'ON CONFLICT (user_id, analysis_hash) DO NOTHING',
      ),
      [userId, hash],
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
});
