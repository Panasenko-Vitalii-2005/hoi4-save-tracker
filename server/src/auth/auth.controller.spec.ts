import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../app.module';
import { sessionCookieSecure, SESSION_COOKIE_SECURE } from './auth.config';
import { AuthController } from './auth.controller';
import {
  AuthUnavailableError,
  AuthValidationError,
  DuplicateEmailError,
  InvalidCredentialsError,
  InvalidSessionError,
} from './auth.errors';
import { AuthService } from './auth.service';

const safeUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};
const authResult = {
  user: safeUser,
  token: 'r'.repeat(43),
  expiresAt: new Date(Date.now() + 3_600_000),
};

describe('AuthController', () => {
  let app: INestApplication<App>;
  let auth: {
    register: jest.Mock;
    login: jest.Mock;
    authenticateSession: jest.Mock;
    logout: jest.Mock;
  };

  beforeEach(async () => {
    auth = {
      register: jest.fn(),
      login: jest.fn(),
      authenticateSession: jest.fn(),
      logout: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: SESSION_COOKIE_SECURE, useValue: false },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(() => app.close());

  test('register returns a safe user and hardened session cookie', async () => {
    auth.register.mockResolvedValue(authResult);
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'user@example.com', password: 'valid password' })
      .expect(201);

    expect(response.body).toEqual({
      user: { ...safeUser, createdAt: safeUser.createdAt.toISOString() },
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /passwordHash|password_hash|tokenHash|token_hash|rrrr/,
    );
    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toContain('hoi4_session=');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Expires=');
    expect(cookie).toContain('Max-Age=');
    expect(cookie).not.toContain('Secure');
  });

  test.each([
    [new AuthValidationError('A valid email address is required'), 400],
    [new DuplicateEmailError(), 409],
    [new AuthUnavailableError(), 503],
  ])(
    'maps register domain errors without database detail',
    async (error, status) => {
      auth.register.mockRejectedValue(error);
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email: 'user@example.com', password: 'valid password' })
        .expect(status);
      expect(JSON.stringify(response.body)).not.toMatch(
        /postgres|sql|password_hash/i,
      );
    },
  );

  test('login uses one generic unauthorized response for credential failure', async () => {
    auth.login.mockRejectedValue(new InvalidCredentialsError());
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'missing@example.com', password: 'wrong password' })
      .expect(401);
    expect(response.body).toMatchObject({ message: 'Invalid authentication' });
    expect(response.body).not.toHaveProperty('user');
  });

  test('login succeeds without returning the raw session token in JSON', async () => {
    auth.login.mockResolvedValue(authResult);
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'valid password' })
      .expect(200);
    expect(response.body).toMatchObject({
      user: { email: 'user@example.com' },
    });
    expect(JSON.stringify(response.body)).not.toContain(authResult.token);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
  });

  test('me authenticates only the auth cookie and rejects absent or invalid sessions', async () => {
    auth.authenticateSession.mockResolvedValueOnce(safeUser);
    const valid = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', `hoi4_session=${authResult.token}`)
      .expect(200);
    expect(valid.body).toMatchObject({ user: { email: 'user@example.com' } });
    expect(auth.authenticateSession).toHaveBeenCalledWith(authResult.token);

    auth.authenticateSession.mockRejectedValueOnce(new InvalidSessionError());
    const missing = await request(app.getHttpServer())
      .get('/api/auth/me')
      .expect(401);
    expect(missing.body).toMatchObject({ message: 'Invalid authentication' });
    expect(auth.authenticateSession).toHaveBeenLastCalledWith(null);
  });

  test('logout revokes the current session and clears the cookie idempotently', async () => {
    auth.logout.mockResolvedValue(undefined);
    const response = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', `hoi4_session=${authResult.token}`)
      .expect(204);
    expect(auth.logout).toHaveBeenCalledWith(authResult.token);
    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toContain('hoi4_session=;');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');

    await request(app.getHttpServer()).post('/api/auth/logout').expect(204);
    expect(auth.logout).toHaveBeenLastCalledWith(null);
  });

  test('unexpected hashing failures are generic and do not echo secrets', async () => {
    auth.register.mockRejectedValue(new Error('secret-password-value'));
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'user@example.com', password: 'secret-password-value' })
      .expect(500);
    expect(JSON.stringify(response.body)).not.toContain(
      'secret-password-value',
    );
  });

  test('Secure cookie behavior depends on exact production environment', () => {
    expect(sessionCookieSecure({ NODE_ENV: 'production' })).toBe(true);
    expect(sessionCookieSecure({ NODE_ENV: 'development' })).toBe(false);
    expect(sessionCookieSecure({ NODE_ENV: 'true' })).toBe(false);
    expect(sessionCookieSecure({})).toBe(false);
    expect(
      sessionCookieSecure({
        NODE_ENV: 'production',
        HOI4_SESSION_COOKIE_SECURE: 'false',
      }),
    ).toBe(false);
    expect(
      sessionCookieSecure({
        NODE_ENV: 'development',
        HOI4_SESSION_COOKIE_SECURE: 'true',
      }),
    ).toBe(true);
    expect(() =>
      sessionCookieSecure({ HOI4_SESSION_COOKIE_SECURE: 'yes' }),
    ).toThrow('HOI4_SESSION_COOKIE_SECURE');
  });
});

describe('Phase 2A application boundary', () => {
  let app: INestApplication<App>;
  const previousEnabled = process.env.HOI4_DATABASE_ENABLED;

  beforeAll(async () => {
    delete process.env.HOI4_DATABASE_ENABLED;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (previousEnabled === undefined) delete process.env.HOI4_DATABASE_ENABLED;
    else process.env.HOI4_DATABASE_ENABLED = previousEnabled;
  });

  test('DB-disabled auth is unavailable while existing health API stays public', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'valid password' })
      .expect(503);
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok', database: 'disabled' });
  });

  test('existing analyzer endpoint has no accidental auth guard', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/analyze')
      .send({ path: 'not-enabled.hoi4' });
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(503);
  });
});
