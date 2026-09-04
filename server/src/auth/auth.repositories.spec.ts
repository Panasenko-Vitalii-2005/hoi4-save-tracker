import type { QueryResult } from 'pg';
import type { DatabaseService } from '../database/database.service';
import { DuplicateEmailError } from './auth.errors';
import type { SessionRecord, UserRecord } from './auth.types';
import { SessionRepository } from './session.repository';
import { UserRepository } from './user.repository';

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

describe('authentication repositories', () => {
  const user: UserRecord = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    passwordHash: 'encoded-hash',
    isAdmin: false,
    disabled: false,
    emailVerifiedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const session: SessionRecord = {
    id: '22222222-2222-4222-8222-222222222222',
    userId: user.id,
    tokenHash: 'a'.repeat(64),
    expiresAt: new Date('2026-01-02T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastSeenAt: null,
  };
  let database: { query: jest.Mock };

  beforeEach(() => {
    database = { query: jest.fn() };
  });

  test('creates and looks up users without exposing SQL from controllers', async () => {
    database.query.mockResolvedValue(result([user]));
    const repository = new UserRepository(
      database as unknown as DatabaseService,
    );

    await expect(
      repository.create(user.email, user.passwordHash as string),
    ).resolves.toEqual(user);
    await expect(repository.findByEmail(user.email)).resolves.toEqual(user);
    await expect(repository.findById(user.id)).resolves.toEqual(user);
    expect(database.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO users'),
      [user.email, user.passwordHash],
    );
    expect(database.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('WHERE email = $1'),
      [user.email],
    );
    expect(database.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('WHERE id = $1'),
      [user.id],
    );
  });

  test('returns null for missing user lookup', async () => {
    database.query.mockResolvedValue(result([]));
    const repository = new UserRepository(
      database as unknown as DatabaseService,
    );
    await expect(
      repository.findByEmail('missing@example.com'),
    ).resolves.toBeNull();
    await expect(repository.findById(user.id)).resolves.toBeNull();
  });

  test('maps PostgreSQL uniqueness conflicts to a stable domain error', async () => {
    database.query.mockRejectedValue({
      code: '23505',
      detail: 'raw db detail',
    });
    const repository = new UserRepository(
      database as unknown as DatabaseService,
    );
    await expect(
      repository.create(user.email, user.passwordHash as string),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  test('creates, looks up and idempotently revokes a session by token hash', async () => {
    database.query
      .mockResolvedValueOnce(result([session]))
      .mockResolvedValueOnce(result([session]))
      .mockResolvedValueOnce(result([]));
    const repository = new SessionRepository(
      database as unknown as DatabaseService,
    );

    await expect(
      repository.create(session.userId, session.tokenHash, session.expiresAt),
    ).resolves.toEqual(session);
    await expect(
      repository.findByTokenHash(session.tokenHash),
    ).resolves.toEqual(session);
    await expect(repository.revoke(session.tokenHash)).resolves.toBeUndefined();
    expect(database.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO sessions'),
      [session.userId, session.tokenHash, session.expiresAt],
    );
    expect(database.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('WHERE token_hash = $1'),
      [session.tokenHash],
    );
    expect(database.query).toHaveBeenNthCalledWith(
      3,
      'DELETE FROM sessions WHERE token_hash = $1',
      [session.tokenHash],
    );
  });
});
