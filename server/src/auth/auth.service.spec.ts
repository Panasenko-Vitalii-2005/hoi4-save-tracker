import type { DatabaseExecutor } from '../database/database.service';
import { DatabaseService } from '../database/database.service';
import {
  AuthUnavailableError,
  DuplicateEmailError,
  InvalidCredentialsError,
  InvalidSessionError,
} from './auth.errors';
import { AuthService } from './auth.service';
import type { SessionRecord, UserRecord } from './auth.types';
import { PasswordService } from './password.service';
import { SessionRepository } from './session.repository';
import { SessionTokenService } from './session-token.service';
import { UserRepository } from './user.repository';

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    passwordHash: 'encoded-password-hash',
    isAdmin: false,
    disabled: false,
    emailVerifiedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    userId: user().id,
    tokenHash: 'a'.repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastSeenAt: null,
    ...overrides,
  };
}

describe('AuthService', () => {
  const executor = {} as DatabaseExecutor;
  let database: jest.Mocked<Pick<DatabaseService, 'available' | 'transaction'>>;
  let users: jest.Mocked<
    Pick<UserRepository, 'create' | 'findByEmail' | 'findById'>
  >;
  let sessions: jest.Mocked<
    Pick<SessionRepository, 'create' | 'findByTokenHash' | 'revoke'>
  >;
  let passwords: jest.Mocked<
    Pick<PasswordService, 'hash' | 'verify' | 'verifyDummy'>
  >;
  let tokens: jest.Mocked<
    Pick<SessionTokenService, 'generate' | 'hash' | 'valid'>
  >;
  let auth: AuthService;

  beforeEach(() => {
    database = {
      available: jest.fn().mockReturnValue(true),
      transaction: jest.fn(async (operation) => operation(executor)),
    };
    users = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
    };
    sessions = {
      create: jest.fn(),
      findByTokenHash: jest.fn(),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    passwords = {
      hash: jest.fn().mockResolvedValue('encoded-password-hash'),
      verify: jest.fn(),
      verifyDummy: jest.fn().mockResolvedValue(false),
    };
    tokens = {
      generate: jest.fn().mockReturnValue('r'.repeat(43)),
      hash: jest.fn().mockReturnValue('a'.repeat(64)),
      valid: jest.fn().mockReturnValue(true),
    };
    auth = new AuthService(
      database as unknown as DatabaseService,
      users as unknown as UserRepository,
      sessions as unknown as SessionRepository,
      passwords,
      tokens,
      3600,
    );
  });

  test('registers normalized identity and session atomically', async () => {
    const created = user();
    users.create.mockResolvedValue(created);
    sessions.create.mockResolvedValue(session());

    const result = await auth.register('  USER@Example.com ', 'valid password');

    expect(passwords.hash).toHaveBeenCalledWith('valid password');
    expect(users.create).toHaveBeenCalledWith(
      'user@example.com',
      'encoded-password-hash',
      executor,
    );
    expect(sessions.create).toHaveBeenCalledWith(
      created.id,
      'a'.repeat(64),
      expect.any(Date),
      executor,
    );
    expect(result.user).toEqual({
      id: created.id,
      email: created.email,
      createdAt: created.createdAt.toISOString(),
    });
    expect(result.token).toBe('r'.repeat(43));
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result).not.toHaveProperty('passwordHash');
    expect(database.transaction).toHaveBeenCalledTimes(1);
  });

  test('preserves duplicate-email conflict from database uniqueness', async () => {
    users.create.mockRejectedValue(new DuplicateEmailError());
    await expect(
      auth.register('user@example.com', 'valid password'),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  test('logs in with a generic safe user result and creates a fixed-expiry session', async () => {
    const existing = user();
    users.findByEmail.mockResolvedValue(existing);
    passwords.verify.mockResolvedValue(true);
    sessions.create.mockResolvedValue(session());

    const before = Date.now();
    const result = await auth.login('USER@example.com', 'valid password');
    expect(users.findByEmail).toHaveBeenCalledWith('user@example.com');
    expect(passwords.verify).toHaveBeenCalledWith(
      'valid password',
      existing.passwordHash,
    );
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 3_600_000,
    );
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  test('wrong password and nonexistent identity use the same error', async () => {
    users.findByEmail.mockResolvedValueOnce(user());
    passwords.verify.mockResolvedValueOnce(false);
    await expect(
      auth.login('user@example.com', 'wrong password'),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    users.findByEmail.mockResolvedValueOnce(null);
    await expect(
      auth.login('missing@example.com', 'wrong password'),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(passwords.verifyDummy).toHaveBeenCalledWith('wrong password');
  });

  test('disabled users cannot login even with a correct password', async () => {
    users.findByEmail.mockResolvedValue(user({ disabled: true }));
    passwords.verify.mockResolvedValue(true);
    await expect(
      auth.login('user@example.com', 'valid password'),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(sessions.create).not.toHaveBeenCalled();
  });

  test('authenticates valid sessions and returns only safe user fields', async () => {
    sessions.findByTokenHash.mockResolvedValue(session());
    users.findById.mockResolvedValue(user());
    await expect(auth.authenticateSession('r'.repeat(43))).resolves.toEqual({
      id: user().id,
      email: user().email,
      createdAt: user().createdAt.toISOString(),
    });
    expect(sessions.findByTokenHash).toHaveBeenCalledWith('a'.repeat(64));
  });

  test('rejects malformed, missing, expired, revoked and disabled-user sessions', async () => {
    tokens.valid.mockReturnValueOnce(false);
    await expect(auth.authenticateSession(null)).rejects.toBeInstanceOf(
      InvalidSessionError,
    );

    sessions.findByTokenHash.mockResolvedValueOnce(null);
    await expect(
      auth.authenticateSession('r'.repeat(43)),
    ).rejects.toBeInstanceOf(InvalidSessionError);

    sessions.findByTokenHash.mockResolvedValueOnce(
      session({ expiresAt: new Date(Date.now() - 1) }),
    );
    await expect(
      auth.authenticateSession('r'.repeat(43)),
    ).rejects.toBeInstanceOf(InvalidSessionError);
    expect(sessions.revoke).toHaveBeenCalledWith('a'.repeat(64));

    sessions.findByTokenHash.mockResolvedValueOnce(session());
    users.findById.mockResolvedValueOnce(user({ disabled: true }));
    await expect(
      auth.authenticateSession('r'.repeat(43)),
    ).rejects.toBeInstanceOf(InvalidSessionError);
  });

  test('logout is idempotent and only hashes well-formed tokens', async () => {
    await auth.logout('r'.repeat(43));
    await auth.logout('r'.repeat(43));
    expect(sessions.revoke).toHaveBeenCalledTimes(2);

    tokens.valid.mockReturnValueOnce(false);
    await auth.logout(null);
    expect(sessions.revoke).toHaveBeenCalledTimes(2);
  });

  test.each(['register', 'login', 'authenticateSession', 'logout'] as const)(
    '%s fails predictably when PostgreSQL is disabled',
    async (operation) => {
      database.available.mockReturnValue(false);
      const result =
        operation === 'register'
          ? auth.register('user@example.com', 'valid password')
          : operation === 'login'
            ? auth.login('user@example.com', 'valid password')
            : operation === 'authenticateSession'
              ? auth.authenticateSession('r'.repeat(43))
              : auth.logout('r'.repeat(43));
      await expect(result).rejects.toBeInstanceOf(AuthUnavailableError);
    },
  );

  test('maps runtime repository failures to unavailable without leaking details', async () => {
    users.findByEmail.mockRejectedValue(new Error('password=secret db host'));
    await expect(
      auth.login('user@example.com', 'valid password'),
    ).rejects.toEqual(new AuthUnavailableError());
  });
});
