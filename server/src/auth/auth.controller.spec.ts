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
} from './auth.errors';
import { AuthService } from './auth.service';
import { CsrfService } from './csrf.service';

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
  const csrf = { bootstrap: jest.fn() };

  beforeEach(async () => {
    auth = {
      register: jest.fn(),
      login: jest.fn(),
      authenticateSession: jest.fn(),
      logout: jest.fn(),
    };
    csrf.bootstrap.mockReset();
    csrf.bootstrap.mockReturnValue('c'.repeat(43));
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: CsrfService, useValue: csrf },
        { provide: SESSION_COOKIE_SECURE, useValue: false },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(() => app.close());

  test('CSRF bootstrap returns the independent readable token', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/csrf')
      .expect(200);
    expect(response.body).toEqual({ csrfToken: 'c'.repeat(43) });
    expect(csrf.bootstrap).toHaveBeenCalledTimes(1);
  });

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

  test('me returns only the safe principal supplied by the authentication boundary', () => {
    expect(app.get(AuthController).me(safeUser)).toEqual({ user: safeUser });
    expect(auth.authenticateSession).not.toHaveBeenCalled();
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
    expect(auth.logout).toHaveBeenCalledTimes(1);
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

describe('Phase 2B application boundary', () => {
  let app: INestApplication<App>;
  const previousEnabled = process.env.HOI4_DATABASE_ENABLED;
  const previousLocal = process.env.HOI4_LOCAL_SAVES_ENABLED;

  beforeAll(async () => {
    delete process.env.HOI4_DATABASE_ENABLED;
    delete process.env.HOI4_LOCAL_SAVES_ENABLED;
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
    if (previousLocal === undefined)
      delete process.env.HOI4_LOCAL_SAVES_ENABLED;
    else process.env.HOI4_LOCAL_SAVES_ENABLED = previousLocal;
  });

  test('DB-disabled auth is unavailable while existing health API stays public', async () => {
    const csrf = await request(app.getHttpServer())
      .get('/api/auth/csrf')
      .expect(200);
    const cookie = (csrf.headers['set-cookie'] as unknown as string[])[0].split(
      ';',
    )[0];
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', (csrf.body as { csrfToken: string }).csrfToken)
      .send({ email: 'user@example.com', password: 'valid password' })
      .expect(503);
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok', database: 'disabled' });
  });

  test('all local-disabled APIs stay hidden before authentication', async () => {
    await request(app.getHttpServer()).get('/api/saves').expect(404);
    await request(app.getHttpServer())
      .get('/api/saves/default-dir')
      .expect(404);
    await request(app.getHttpServer())
      .post('/saves/analyze')
      .send({ paths: ['not-enabled.hoi4'] })
      .expect(404);
    await request(app.getHttpServer())
      .post('/api/analyze')
      .send({ path: 'not-enabled.hoi4' })
      .expect(404);
  });

  test('local-enabled and multipart analysis APIs follow authentication policy', async () => {
    process.env.HOI4_LOCAL_SAVES_ENABLED = 'true';
    try {
      await request(app.getHttpServer()).get('/api/saves').expect(401);
      await request(app.getHttpServer())
        .post('/saves/analyze')
        .send({ paths: ['save.hoi4'] })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/analyze')
        .send({ path: 'save.hoi4' })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/analyze')
        .set('Content-Type', 'multipart/form-data; boundary=phase2b')
        .send('--phase2b--')
        .expect(401);
    } finally {
      delete process.env.HOI4_LOCAL_SAVES_ENABLED;
    }
  });

  test('private application APIs do not become anonymous when DB mode is disabled', async () => {
    await request(app.getHttpServer()).get('/api/analyze/recent').expect(401);
    await request(app.getHttpServer())
      .get('/api/analyze/recent')
      .set('Cookie', `hoi4_session=${authResult.token}`)
      .expect(503);
  });
});
